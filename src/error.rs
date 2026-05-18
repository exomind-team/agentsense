use std::fmt;

#[derive(Debug)]
pub enum AgentSenseError {
    FileNotFound(String),
    InvalidPdf(String),
    Encrypted(String),
    Io(std::io::Error),
    Parse(String),
    Http(String),
    Config(String),
    Database(String),
}

impl fmt::Display for AgentSenseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::FileNotFound(path) => write!(f, "file not found: {path}"),
            Self::InvalidPdf(msg) => write!(f, "invalid PDF: {msg}"),
            Self::Encrypted(msg) => write!(f, "encrypted PDF: {msg}"),
            Self::Io(e) => write!(f, "I/O error: {e}"),
            Self::Parse(msg) => write!(f, "parse error: {msg}"),
            Self::Http(msg) => write!(f, "HTTP error: {msg}"),
            Self::Config(msg) => write!(f, "config error: {msg}"),
            Self::Database(msg) => write!(f, "database error: {msg}"),
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

impl From<rusqlite::Error> for AgentSenseError {
    fn from(e: rusqlite::Error) -> Self {
        Self::Database(e.to_string())
    }
}

impl From<reqwest::Error> for AgentSenseError {
    fn from(e: reqwest::Error) -> Self {
        Self::Http(e.to_string())
    }
}

impl From<toml::de::Error> for AgentSenseError {
    fn from(e: toml::de::Error) -> Self {
        Self::Config(e.to_string())
    }
}
