use std::fmt::{Display, Formatter};

#[derive(Debug)]
pub struct StudioError(pub String);

impl Display for StudioError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for StudioError {}

impl From<std::io::Error> for StudioError {
    fn from(error: std::io::Error) -> Self {
        Self(error.to_string())
    }
}

impl From<serde_json::Error> for StudioError {
    fn from(error: serde_json::Error) -> Self {
        Self(error.to_string())
    }
}

impl From<walkdir::Error> for StudioError {
    fn from(error: walkdir::Error) -> Self {
        Self(error.to_string())
    }
}

pub type StudioResult<T> = Result<T, StudioError>;

pub fn error(message: impl Into<String>) -> StudioError {
    StudioError(message.into())
}
