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
}

/// Open a PDF with the given engine and extract metadata.
pub(crate) fn open_with_engine(
    path: &Path,
    engine: PdfEngine,
) -> Result<OpenResult, AgentSenseError> {
    match engine {
        PdfEngine::Lopdf => open_lopdf(path),
        PdfEngine::PdfsinkRs => open_pdfsink(path),
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

    // Try to get first page size
    let (page_width_pt, page_height_pt) = pdf
        .page(1)
        .ok()
        .map(|p| (p.width, p.height))
        .unwrap_or((612.0, 792.0));

    let info = DocumentInfo {
        title: None, // pdfsink-rs doesn't expose metadata directly in 0.2
        author: None,
        creator: None,
        producer: None,
        subject: None,
        keywords: None,
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
