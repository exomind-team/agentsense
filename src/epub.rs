//! EPUB document reader.
//! Uses the `epub` crate to parse EPUB 2/3 files.

use std::path::Path;

use epub::doc::EpubDoc;

use crate::error::AgentSenseError;

/// An EPUB document opened for reading.
pub struct EpubDocument {
    title: Option<String>,
    author: Option<String>,
    chapter_count: usize,
    path: std::path::PathBuf,
}

impl EpubDocument {
    /// Open an EPUB file and return a document handle.
    pub fn open(path: &Path) -> Result<Self, AgentSenseError> {
        if !path.exists() {
            return Err(AgentSenseError::FileNotFound(path.display().to_string()));
        }

        let doc = EpubDoc::new(path)
            .map_err(|e| AgentSenseError::Parse(format!("failed to open EPUB: {e}")))?;

        let chapter_count = doc.spine.len();
        let title = doc.mdata("title").map(|m| m.value.clone());
        let author = doc.mdata("creator").map(|m| m.value.clone());

        Ok(Self {
            title,
            author,
            chapter_count,
            path: path.to_path_buf(),
        })
    }

    /// Title from EPUB metadata.
    pub fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }

    /// Author from EPUB metadata.
    pub fn author(&self) -> Option<&str> {
        self.author.as_deref()
    }

    /// Total number of chapters (spine items).
    pub fn chapter_count(&self) -> usize {
        self.chapter_count
    }

    /// Read a chapter by index (1-indexed spine position).
    pub fn read_chapter(&self, index: usize) -> Result<String, AgentSenseError> {
        if index == 0 || index > self.chapter_count {
            return Err(AgentSenseError::Parse(format!(
                "chapter {} out of range (1-{})",
                index, self.chapter_count
            )));
        }

        let mut doc = EpubDoc::new(&self.path)
            .map_err(|e| AgentSenseError::Parse(format!("failed to open EPUB for read: {e}")))?;

        if !doc.set_current_chapter(index - 1) {
            return Err(AgentSenseError::Parse(format!(
                "failed to navigate to chapter {}",
                index
            )));
        }

        // get_current_str() returns Option<(String, String)> — (content, mime)
        doc.get_current_str()
            .map(|(content, _mime)| strip_html(&content))
            .ok_or_else(|| AgentSenseError::Parse(format!("chapter {} has no content", index)))
    }

    /// Extract all text content from all chapters (HTML tags stripped).
    pub fn text(&self) -> Result<String, AgentSenseError> {
        let mut doc = EpubDoc::new(&self.path)
            .map_err(|e| AgentSenseError::Parse(format!("failed to open EPUB for text: {e}")))?;

        let mut all = String::new();
        let total = doc.spine.len();
        for i in 0..total {
            doc.set_current_chapter(i);
            if let Some((content, _mime)) = doc.get_current_str() {
                let clean = strip_html(&content);
                if !clean.is_empty() {
                    if !all.is_empty() {
                        all.push('\n');
                    }
                    all.push_str(&clean);
                }
            }
        }
        Ok(all)
    }
}

/// Naive HTML tag stripper — removes tags, decodes common entities.
fn strip_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    let mut chars = html.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '<' {
            in_tag = true;
        } else if ch == '>' {
            in_tag = false;
        } else if !in_tag {
            if ch == '&' {
                let entity: String = chars.by_ref().take_while(|c| *c != ';').collect();
                match entity.as_str() {
                    "amp" => out.push('&'),
                    "lt" => out.push('<'),
                    "gt" => out.push('>'),
                    "quot" => out.push('"'),
                    "apos" => out.push('\''),
                    "nbsp" => out.push(' '),
                    _ => {} // skip unknown entities
                }
            } else {
                out.push(ch);
            }
        }
    }
    // Collapse whitespace
    let collapsed: String = out
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    collapsed
}
