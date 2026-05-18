//! Core data types for AgentSense document parsing.

/// Document metadata extracted from a PDF.
#[derive(Debug)]
pub struct DocumentInfo {
    pub(crate) title: Option<String>,
    pub(crate) author: Option<String>,
    pub(crate) page_count: usize,
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

    /// Total number of pages.
    pub fn page_count(&self) -> usize {
        self.page_count
    }
}
