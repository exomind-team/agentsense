//! AgentSense — ExoMind 感知基础设施的核心库
//!
//! 提供统一的文档解析（PDF/EPUB）、搜索聚合、视觉理解、额度感知能力。
//! 纯 Rust 优先，零外部 C 依赖。

mod config;
mod engine;
mod epub;
mod error;
mod types;

pub mod quota;

use std::path::Path;

pub use config::AppConfig;
pub use engine::PdfEngine;
pub use epub::EpubDocument;
pub use error::AgentSenseError;
pub use types::{DocumentInfo, ImageInfo};

use engine::EngineData;

/// A PDF document opened for reading.
#[derive(Debug)]
pub struct PdfDocument {
    path: std::path::PathBuf,
    info: DocumentInfo,
    engine_data: EngineData,
}

impl PdfDocument {
    /// Open a PDF file with the default engine (Lopdf).
    pub fn open(path: &Path) -> Result<Self, AgentSenseError> {
        Self::with_engine(path, PdfEngine::Lopdf)
    }

    /// Open a PDF file with an explicit engine choice.
    pub fn with_engine(path: &Path, engine: PdfEngine) -> Result<Self, AgentSenseError> {
        if !path.exists() {
            return Err(AgentSenseError::FileNotFound(path.display().to_string()));
        }
        let result = engine::open_with_engine(path, engine)?;
        Ok(Self {
            path: result.path,
            info: result.info,
            engine_data: result.engine_data,
        })
    }

    /// Return document metadata.
    pub fn info(&self) -> &DocumentInfo {
        &self.info
    }

    /// Return the number of pages in this document.
    pub fn page_count(&self) -> usize {
        self.info.page_count
    }

    /// Extract all text content from the document.
    pub fn text(&self) -> Result<String, AgentSenseError> {
        engine::extract_text_with_engine(&self.path, &self.engine_data)
    }

    /// Extract text from a specific page (1-indexed).
    pub fn read_page(&self, page_number: usize) -> Result<String, AgentSenseError> {
        if page_number == 0 || page_number > self.info.page_count {
            return Err(AgentSenseError::InvalidPdf(format!(
                "page {page_number} out of range (1-{})",
                self.info.page_count
            )));
        }
        let pdf = pdfsink_rs::PdfDocument::open(&self.path).map_err(|e| {
            AgentSenseError::InvalidPdf(format!("pdfsink-rs page read failed: {e}"))
        })?;
        let page = pdf
            .page(page_number)
            .map_err(|e| AgentSenseError::InvalidPdf(format!("page {page_number}: {e}")))?;
        Ok(page.extract_text())
    }

    /// List all images in the document with their metadata.
    pub fn list_images(&self) -> Result<Vec<ImageInfo>, AgentSenseError> {
        let pdf = pdfsink_rs::PdfDocument::open(&self.path).map_err(|e| {
            AgentSenseError::InvalidPdf(format!("pdfsink-rs image scan failed: {e}"))
        })?;
        let mut images = Vec::new();
        for page_num in 1..=pdf.len() {
            if let Ok(page) = pdf.page(page_num) {
                for (idx, img) in page.images.iter().enumerate() {
                    images.push(ImageInfo {
                        page: page_num,
                        index: idx,
                        name: img.name.clone(),
                        width: img.srcsize.0,
                        height: img.srcsize.1,
                    });
                }
            }
        }
        Ok(images)
    }

    /// Extract raw image bytes by page number (1-indexed) and image index.
    pub fn extract_image(
        &self,
        page_number: usize,
        image_index: usize,
    ) -> Result<Vec<u8>, AgentSenseError> {
        if page_number == 0 || page_number > self.info.page_count {
            return Err(AgentSenseError::InvalidPdf(format!(
                "page {page_number} out of range"
            )));
        }
        let doc = lopdf::Document::load(&self.path)
            .map_err(|e| AgentSenseError::InvalidPdf(format!("lopdf image extract failed: {e}")))?;
        let pages = doc.get_pages();
        let page_id = pages
            .values()
            .nth(page_number - 1)
            .ok_or_else(|| AgentSenseError::InvalidPdf(format!("page {page_number} not found")))?;
        let page_obj = doc
            .get_object(*page_id)
            .map_err(|e| AgentSenseError::InvalidPdf(format!("page object error: {e}")))?;
        let page_dict = match page_obj {
            lopdf::Object::Dictionary(d) => d,
            _ => {
                return Err(AgentSenseError::InvalidPdf(
                    "page is not a dictionary".into(),
                ))
            }
        };
        let resources = page_dict
            .get(b"Resources")
            .ok()
            .ok_or_else(|| AgentSenseError::InvalidPdf("no Resources dict on page".into()))?;
        let res_dict = match resources {
            lopdf::Object::Dictionary(d) => d,
            lopdf::Object::Reference(id) => match doc.get_object(*id).ok() {
                Some(lopdf::Object::Dictionary(d)) => d,
                _ => {
                    return Err(AgentSenseError::InvalidPdf(
                        "Resources ref unresolved".into(),
                    ))
                }
            },
            _ => return Err(AgentSenseError::InvalidPdf("bad Resources type".into())),
        };
        let xobject = res_dict
            .get(b"XObject")
            .ok()
            .ok_or_else(|| AgentSenseError::InvalidPdf("no XObject dict in resources".into()))?;
        let xobj_dict = match xobject {
            lopdf::Object::Dictionary(d) => d,
            lopdf::Object::Reference(id) => match doc.get_object(*id).ok() {
                Some(lopdf::Object::Dictionary(d)) => d,
                _ => return Err(AgentSenseError::InvalidPdf("XObject ref unresolved".into())),
            },
            _ => return Err(AgentSenseError::InvalidPdf("bad XObject type".into())),
        };
        // Iterate XObjects to find the nth image
        let mut found = 0usize;
        for (_name, obj) in xobj_dict.iter() {
            let img_id = match obj {
                lopdf::Object::Reference(id) => id,
                _ => continue,
            };
            let img_obj = match doc.get_object(*img_id).ok() {
                Some(o) => o,
                None => continue,
            };
            let img_stream = match img_obj {
                lopdf::Object::Stream(s) => s,
                _ => continue,
            };
            let is_image = img_stream
                .dict
                .get(b"Subtype")
                .ok()
                .map(|o| matches!(o, lopdf::Object::Name(n) if n == b"Image"))
                .unwrap_or(false);
            if !is_image {
                continue;
            }
            if found == image_index {
                // Return the raw stream bytes (for JPEG/DCTDecode, this is the JPEG data)
                return Ok(img_stream.content.clone());
            }
            found += 1;
        }
        Err(AgentSenseError::InvalidPdf(format!(
            "image index {image_index} not found on page {page_number} (found {found} images)"
        )))
    }
}

// ── Shared helpers (used by engine::open_lopdf) ────────────────────

/// Read a string field from the PDF's Info dictionary.
pub(crate) fn read_info_field(doc: &lopdf::Document, field_key: &[u8]) -> Option<String> {
    let info_obj = doc.trailer.get(b"Info").ok()?;
    let info_id = match info_obj {
        lopdf::Object::Reference(id) => id,
        _ => return None,
    };
    let info = doc.get_object(*info_id).ok()?;
    let dict = match info {
        lopdf::Object::Dictionary(d) => d,
        _ => return None,
    };
    let value = dict.get(field_key).ok()?;
    text_from_object(value)
}

/// Get the MediaBox dimensions of the first page (in points).
pub(crate) fn first_page_size(doc: &lopdf::Document) -> (f64, f64) {
    let pages = doc.get_pages();
    let first_page_id = match pages.values().next() {
        Some(id) => id,
        None => return (612.0, 792.0),
    };
    let page_obj = match doc.get_object(*first_page_id).ok() {
        Some(obj) => obj,
        None => return (612.0, 792.0),
    };
    let page_dict = match page_obj {
        lopdf::Object::Dictionary(d) => d,
        _ => return (612.0, 792.0),
    };
    let media_box = match page_dict.get(b"MediaBox").ok() {
        Some(obj) => obj,
        None => return (612.0, 792.0),
    };
    if let lopdf::Object::Array(arr) = media_box {
        if arr.len() >= 4 {
            let w = float_val(&arr[2]);
            let h = float_val(&arr[3]);
            if w > 0.0 && h > 0.0 {
                return (w, h);
            }
        }
    }
    (612.0, 792.0)
}

pub(crate) fn float_val(obj: &lopdf::Object) -> f64 {
    match obj {
        lopdf::Object::Integer(n) => *n as f64,
        lopdf::Object::Real(f) => *f as f64,
        _ => 0.0,
    }
}

/// Extract a text value from a PDF object (handles both string and name types).
fn text_from_object(obj: &lopdf::Object) -> Option<String> {
    match obj {
        lopdf::Object::String(bytes, _) => String::from_utf8(bytes.clone()).ok(),
        lopdf::Object::Name(name) => String::from_utf8(name.clone()).ok(),
        _ => None,
    }
}
