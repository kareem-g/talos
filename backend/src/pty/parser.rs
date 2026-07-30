#[derive(Debug, Clone)]
pub enum ParsedOutput {
    Text(String),
    Plan { title: String, steps: Vec<String> },
    Diff { file: String, hunks: Vec<DiffHunk> },
    ToolCall { name: String, params: serde_json::Value },
    ApprovalRequest { prompt: String },
    Error(String),
}

#[derive(Debug, Clone)]
pub struct DiffHunk {
    pub old_start: usize,
    pub old_lines: usize,
    pub new_start: usize,
    pub new_lines: usize,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone)]
pub enum DiffLine {
    Context(String),
    Added(String),
    Removed(String),
}

pub struct OutputParser;

impl OutputParser {
    pub fn parse_chunk(chunk: &str) -> Vec<ParsedOutput> {
        let mut outputs = vec![];

        // Simple heuristic parsing - in production, use proper regex/state machine
        if chunk.contains("```diff") || chunk.contains("diff --git") {
            outputs.push(ParsedOutput::Diff {
                file: "unknown".to_string(),
                hunks: vec![],
            });
        }

        if chunk.contains("I need your approval") || chunk.contains("Do you want me to") {
            outputs.push(ParsedOutput::ApprovalRequest {
                prompt: chunk.to_string(),
            });
        }

        if outputs.is_empty() {
            outputs.push(ParsedOutput::Text(chunk.to_string()));
        }

        outputs
    }
}
