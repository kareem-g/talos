use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestionOption {
    pub id: String,
    pub label: String,
    pub description: Option<String>,
    pub allows_custom_text: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Question {
    pub question_id: String,
    pub session_id: String,
    pub title: String,
    pub question: String,
    pub options: Vec<QuestionOption>,
    pub selection_mode: String,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub answered_at: Option<DateTime<Utc>>,
    pub selected_options: Vec<String>,
    pub custom_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuestionAnswer {
    pub question_id: String,
    pub session_id: Option<String>,
    pub selected_options: Vec<String>,
    pub custom_text: Option<String>,
}
