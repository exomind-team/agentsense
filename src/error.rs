//! Error types for AgentSense.

use std::fmt;

/// Errors that can occur when working with documents.
#[derive(Debug)]
pub enum AgentSenseError {
    /// File not found at the given path.
    FileNotFound(String),
    /// The file is not a valid PDF (or is corrupted).
    InvalidPdf(String),
    /// The PDF is encrypted and requires a password.
    Encrypted(String),
    /// An I/O error occurred.
    Io(std::io::Error),
    /// A lopdf parsing error occurred.
    Parse(String),
}

impl fmt::Display for AgentSenseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::FileNotFound(path) => write!(f, "file not found: {path}"),
            Self::InvalidPdf(msg) => write!(f, "invalid PDF: {msg}"),
            Self::Encrypted(msg) => write!(f, "encrypted PDF: {msg}"),
            Self::Io(e) => write!(f, "I/O error: {e}"),
            Self::Parse(msg) => write!(f, "parse error: {msg}"),
        }
    }
}

impl std::error::Error for AgentSenseError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(e) => Some(e),
            _ => None,
        }
    }
}

impl From<std::io::Error> for AgentSenseError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}
