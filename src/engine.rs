//! PDF engine abstraction — pluggable backends for PDF parsing.
//!
//! AgentSense supports multiple PDF engines behind a unified API:
//! - [`PdfEngine::Lopdf`] — pure Rust via lopdf + pdf-extract (default, zero C deps)
//! - [`PdfEngine::PdfsinkRs`] — pure Rust via pdfsink-rs (faster, tables, layout)

use std::path::Path;

use crate::error::AgentSenseError;
use crate::types::DocumentInfo;

/// Supported PDF parsing engines.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PdfEngine {
    /// Pure Rust — lopdf + pdf-extract. Default, zero external deps.
    Lopdf,
    /// Pure Rust — pdfsink-rs. Faster text/table/layout extraction.
    PdfsinkRs,
    /// poppler-glib via FFI. Best text extraction quality, requires C library.
    /// Enable with: `cargo build --features poppler`
    /// Windows: `choco install poppler`
    #[cfg(feature = "poppler")]
    Poppler,
}

/// Internal result of opening a PDF with a specific engine.
pub(crate) struct OpenResult {
    pub info: DocumentInfo,
    pub path: std::path::PathBuf,
    /// Cached text from the engine (lazily extracted).
    pub engine_data: EngineData,
}

#[derive(Debug)]
pub(crate) enum EngineData {
    Lopdf,
    PdfsinkRs {
        /// Cached page texts, None = not yet extracted
        page_texts: std::sync::Mutex<Option<Vec<String>>>,
    },
    #[cfg(feature = "poppler")]
    #[allow(dead_code)]
    // Reserved poppler-engine variant; not yet constructed but kept for future use.
    Poppler,
}

/// Open a PDF with the given engine and extract metadata.
pub(crate) fn open_with_engine(
    path: &Path,
    engine: PdfEngine,
) -> Result<OpenResult, AgentSenseError> {
    match engine {
        PdfEngine::Lopdf => open_lopdf(path),
        PdfEngine::PdfsinkRs => open_pdfsink(path),
        #[cfg(feature = "poppler")]
        PdfEngine::Poppler => open_poppler(path),
    }
}

/// Extract text using the engine-specific method.
pub(crate) fn extract_text_with_engine(
    path: &Path,
    engine_data: &EngineData,
) -> Result<String, AgentSenseError> {
    match engine_data {
        EngineData::Lopdf => pdf_extract::extract_text(path)
            .map_err(|e| AgentSenseError::Parse(format!("text extraction failed: {e}"))),
        EngineData::PdfsinkRs { page_texts } => {
            // Use cached page texts if available
            if let Some(ref texts) = *page_texts.lock().unwrap() {
                return Ok(texts.join("\n"));
            }
            // Fallback: re-open and extract
            let pdf = pdfsink_rs::PdfDocument::open(path)
                .map_err(|e| AgentSenseError::InvalidPdf(format!("pdfsink-rs failed: {e}")))?;
            let mut texts = Vec::with_capacity(pdf.len());
            for i in 1..=pdf.len() {
                if let Ok(page) = pdf.page(i) {
                    texts.push(page.extract_text());
                }
            }
            Ok(texts.join("\n"))
        }
        #[cfg(feature = "poppler")]
        EngineData::Poppler => Err(AgentSenseError::Config(
            "poppler engine text extraction not yet implemented".into(),
        )),
    }
}

fn open_lopdf(path: &Path) -> Result<OpenResult, AgentSenseError> {
    let doc = lopdf::Document::load(path)
        .map_err(|e| AgentSenseError::InvalidPdf(format!("failed to parse PDF: {e}")))?;

    let pages = doc.get_pages();
    let page_count = pages.len();
    let (page_width_pt, page_height_pt) = super::first_page_size(&doc);

    Ok(OpenResult {
        info: DocumentInfo {
            title: super::read_info_field(&doc, b"Title"),
            author: super::read_info_field(&doc, b"Author"),
            creator: super::read_info_field(&doc, b"Creator"),
            producer: super::read_info_field(&doc, b"Producer"),
            subject: super::read_info_field(&doc, b"Subject"),
            keywords: super::read_info_field(&doc, b"Keywords"),
            page_count,
            page_width_pt,
            page_height_pt,
        },
        path: path.to_path_buf(),
        engine_data: EngineData::Lopdf,
    })
}

fn open_pdfsink(path: &Path) -> Result<OpenResult, AgentSenseError> {
    let pdf = pdfsink_rs::PdfDocument::open(path)
        .map_err(|e| AgentSenseError::InvalidPdf(format!("pdfsink-rs failed: {e}")))?;

    let page_count = pdf.len();

    let (page_width_pt, page_height_pt) = pdf
        .page(1)
        .ok()
        .map(|p| (p.width, p.height))
        .unwrap_or((612.0, 792.0));

    // Best-effort metadata from lopdf (doesn't affect open success)
    let meta = try_read_metadata_lopdf(path);

    let info = DocumentInfo {
        title: meta.title,
        author: meta.author,
        creator: meta.creator,
        producer: meta.producer,
        subject: meta.subject,
        keywords: meta.keywords,
        page_count,
        page_width_pt,
        page_height_pt,
    };

    Ok(OpenResult {
        info,
        path: path.to_path_buf(),
        engine_data: EngineData::PdfsinkRs {
            page_texts: std::sync::Mutex::new(None),
        },
    })
}

#[cfg(feature = "poppler")]
fn open_poppler(_path: &Path) -> Result<OpenResult, AgentSenseError> {
    // TODO: Integrate poppler-rs for best-in-class text extraction.
    // Requires poppler-glib C library installed on the system.
    // On Windows: choco install poppler
    // On Linux: apt install libpoppler-glib-dev
    // On macOS: brew install poppler
    Err(AgentSenseError::Config(
        "poppler engine not yet implemented — install poppler C library and rebuild".into(),
    ))
}

/// Best-effort metadata read via lopdf. Silently returns None on failure.
fn try_read_metadata_lopdf(path: &Path) -> PdfMetadata {
    let doc = match lopdf::Document::load(path) {
        Ok(d) => d,
        Err(_) => return PdfMetadata::default(),
    };
    PdfMetadata {
        title: super::read_info_field(&doc, b"Title"),
        author: super::read_info_field(&doc, b"Author"),
        creator: super::read_info_field(&doc, b"Creator"),
        producer: super::read_info_field(&doc, b"Producer"),
        subject: super::read_info_field(&doc, b"Subject"),
        keywords: super::read_info_field(&doc, b"Keywords"),
    }
}

#[derive(Default)]
struct PdfMetadata {
    title: Option<String>,
    author: Option<String>,
    creator: Option<String>,
    producer: Option<String>,
    subject: Option<String>,
    keywords: Option<String>,
}
