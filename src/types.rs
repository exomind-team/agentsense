//! Core data types for AgentSense document parsing.

/// Document metadata extracted from a PDF.
#[derive(Debug)]
pub struct DocumentInfo {
    pub(crate) title: Option<String>,
    pub(crate) author: Option<String>,
    pub(crate) creator: Option<String>,
    pub(crate) producer: Option<String>,
    pub(crate) subject: Option<String>,
    pub(crate) keywords: Option<String>,
    pub(crate) page_count: usize,
    pub(crate) page_width_pt: f64,
    pub(crate) page_height_pt: f64,
}

impl DocumentInfo {
    /// Title from the PDF info dictionary.
    pub fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }

    /// Author from the PDF info dictionary.
    pub fn author(&self) -> Option<&str> {
        self.author.as_deref()
    }

    /// Application that created the document.
    pub fn creator(&self) -> Option<&str> {
        self.creator.as_deref()
    }

    /// Application that produced the final PDF.
    pub fn producer(&self) -> Option<&str> {
        self.producer.as_deref()
    }

    /// Document subject/description.
    pub fn subject(&self) -> Option<&str> {
        self.subject.as_deref()
    }

    /// Keywords associated with the document.
    pub fn keywords(&self) -> Option<&str> {
        self.keywords.as_deref()
    }

    /// Total number of pages.
    pub fn page_count(&self) -> usize {
        self.page_count
    }

    /// Width of the first page in points (1pt = 1/72 inch).
    pub fn page_width_pt(&self) -> f64 {
        self.page_width_pt
    }

    /// Height of the first page in points (1pt = 1/72 inch).
    pub fn page_height_pt(&self) -> f64 {
        self.page_height_pt
    }
}
