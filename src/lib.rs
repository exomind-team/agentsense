//! AgentSense — ExoMind 感知基础设施的核心库
//!
//! 提供统一的文档解析（PDF/EPUB）、搜索聚合、视觉理解能力。
//! 纯 Rust 优先，零外部 C 依赖。

mod error;
mod types;

use std::path::Path;

pub use error::AgentSenseError;
pub use types::DocumentInfo;

/// A PDF document opened for reading.
#[derive(Debug)]
pub struct PdfDocument {
    path: std::path::PathBuf,
    info: DocumentInfo,
}

impl PdfDocument {
    /// Open a PDF file and return a document handle.
    pub fn open(path: &Path) -> Result<Self, AgentSenseError> {
        if !path.exists() {
            return Err(AgentSenseError::FileNotFound(
                path.display().to_string(),
            ));
        }

        let doc = lopdf::Document::load(path).map_err(|e| {
            AgentSenseError::InvalidPdf(format!("failed to parse PDF: {e}"))
        })?;

        let pages = doc.get_pages();
        let page_count = pages.len();

        let title = read_info_field(&doc, b"Title");
        let author = read_info_field(&doc, b"Author");

        Ok(Self {
            path: path.to_path_buf(),
            info: DocumentInfo {
                title,
                author,
                page_count,
            },
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
        let text = pdf_extract::extract_text(&self.path)
            .map_err(|e| AgentSenseError::Parse(format!("text extraction failed: {e}")))?;
        Ok(text)
    }
}

/// Read a string field from the PDF's Info dictionary.
fn read_info_field(doc: &lopdf::Document, field_key: &[u8]) -> Option<String> {
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

/// Extract a text value from a PDF object (handles both string and name types).
fn text_from_object(obj: &lopdf::Object) -> Option<String> {
    match obj {
        lopdf::Object::String(bytes, _) => String::from_utf8(bytes.clone()).ok(),
        lopdf::Object::Name(name) => String::from_utf8(name.clone()).ok(),
        _ => None,
    }
}
