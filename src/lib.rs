//! AgentSense — ExoMind 感知基础设施的核心库
//!
//! 提供统一的文档解析（PDF/EPUB）、搜索聚合、视觉理解、额度感知能力。
//! 纯 Rust 优先，零外部 C 依赖。

mod config;
mod engine;
mod error;
mod types;

pub mod quota;

use std::path::Path;

pub use config::AppConfig;
pub use engine::PdfEngine;
pub use error::AgentSenseError;
pub use types::DocumentInfo;

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
            return Err(AgentSenseError::FileNotFound(
                path.display().to_string(),
            ));
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
