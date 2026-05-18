//! EPUB document reader.
//! Uses the `epub` crate to parse EPUB 2/3 files.

use std::path::Path;

use epub::doc::EpubDoc;

use crate::error::AgentSenseError;
use crate::types::{TocEntry, TocLocation};

/// An EPUB document opened for reading.
pub struct EpubDocument {
    title: Option<String>,
    author: Option<String>,
    chapter_count: usize,
    path: std::path::PathBuf,
    toc: Vec<TocEntry>,
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
        let toc = convert_navpoints(&doc.toc, 0);

        Ok(Self {
            title,
            author,
            chapter_count,
            path: path.to_path_buf(),
            toc,
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

    /// Table of contents tree with section-level granularity.
    pub fn toc(&self) -> &[TocEntry] {
        &self.toc
    }

    /// Read the content for a specific TOC entry.
    /// For entries with fragment anchors, extracts just that section.
    pub fn read_toc_entry(&self, entry: &TocEntry) -> Result<String, AgentSenseError> {
        match &entry.location {
            TocLocation::Epub { path, fragment } => {
                let mut doc = EpubDoc::new(&self.path)
                    .map_err(|e| AgentSenseError::Parse(format!("failed to open EPUB: {e}")))?;

                // Find resource by path (normalize separators: \ → /)
                let normalized_path = path.replace('\\', "/");
                let resource = doc.resources.iter().find(|(_id, r)| {
                    let rp = r.path.to_string_lossy().replace('\\', "/");
                    rp == normalized_path || rp.ends_with(&normalized_path)
                });

                let (res_id, _res) = resource.ok_or_else(|| {
                    AgentSenseError::Parse(format!("resource not found: {normalized_path}"))
                })?;
                let res_id = res_id.clone();

                // Read the resource content
                let (data, _mime) = doc.get_resource(&res_id).ok_or_else(|| {
                    AgentSenseError::Parse(format!("failed to read resource: {res_id}"))
                })?;
                let html = String::from_utf8_lossy(&data).into_owned();

                if let Some(ref frag) = fragment {
                    // Extract just the section around the fragment anchor
                    Ok(extract_section(&html, frag))
                } else {
                    Ok(strip_html(&html))
                }
            }
            _ => Err(AgentSenseError::Parse("not an EPUB TOC entry".into())),
        }
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

/// Convert epub crate's NavPoint tree to our TocEntry tree.
fn convert_navpoints(nav: &[epub::doc::NavPoint], level: usize) -> Vec<TocEntry> {
    nav.iter()
        .map(|np| {
            let path = np.content.to_string_lossy().to_string();
            let (file_path, fragment) = if let Some((p, f)) = path.split_once('#') {
                (p.to_string(), Some(f.to_string()))
            } else {
                (path.clone(), None)
            };
            TocEntry {
                title: np.label.clone(),
                level,
                children: convert_navpoints(&np.children, level + 1),
                location: TocLocation::Epub {
                    path: file_path,
                    fragment,
                },
            }
        })
        .collect()
}

/// Extract text around a fragment anchor in XHTML content.
/// Finds the element with the given ID and returns text until next heading.
fn extract_section(html: &str, fragment: &str) -> String {
    // Find the fragment anchor
    let id_attr = format!("id=\"{fragment}\"");
    let id_single = format!("id='{fragment}'");

    let start = html
        .find(&id_attr)
        .or_else(|| html.find(&id_single))
        .unwrap_or(0);

    // Extract from the start of the anchored element to the end or next heading
    let section = &html[start..];
    // Find next <h1..h6> or <section> boundary
    let end = section
        .find("<h1")
        .or_else(|| section.find("<h2"))
        .or_else(|| section.find("<h3"))
        .or_else(|| section.find("<h4"))
        .or_else(|| section.find("<h5"))
        .or_else(|| section.find("<h6"))
        .or_else(|| section.find("<section"))
        .unwrap_or(section.len());

    strip_html(&section[..end])
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
