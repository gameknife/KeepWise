use std::fmt::{Display, Formatter};

#[derive(Debug)]
pub(crate) struct AppError {
    message: String,
}

pub(crate) type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub(crate) fn message(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for AppError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for AppError {}

impl From<AppError> for String {
    fn from(error: AppError) -> Self {
        error.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_error_preserves_compatible_boundary_text() {
        let result: AppResult<()> = Err(AppError::message("打开数据库失败"));
        assert_eq!(result.unwrap_err().to_string(), "打开数据库失败");
    }
}
