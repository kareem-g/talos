//! Model discovery for providers whose models are not revealed by a handshake.
//!
//! ACP agents enumerate their models in `session/new`, so they need nothing
//! here. Everything else has to be asked, and each CLI answers differently:
//!
//! - `opencode models` prints one opaque id per line. Useful as a pre-session
//!   list (the ACP handshake costs a process spawn), and it includes every
//!   custom provider from the user's own config.
//! - `claude --help` documents its aliases in prose. Fragile, and treated as a
//!   hint: the flag accepts any string, so the list is never exhaustive.
//! - `codex` has no listing command at all. Its `-m` takes any string.
//!
//! Wherever a list cannot be complete, the provider's model option sets
//! `allows_custom_value`, so a model we never discovered stays selectable. That
//! is the difference between "we don't know all the models" and "you may not
//! use a model we don't know".

use super::types::{DiscoverySource, Model};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

/// Model listing can involve a network call (opencode fetches its provider
/// catalog), so this is deliberately longer than a version probe.
const LIST_TIMEOUT: Duration = Duration::from_secs(20);
const HELP_TIMEOUT: Duration = Duration::from_secs(10);

/// Run `opencode models`, one opaque id per line.
///
/// Verified on a real machine: 76 ids across 5 providers, three of which are the
/// user's own `openai-compatible` endpoints. Non-model chatter appears on stdout
/// (`[opencode-mobile] v1.4.0`, banner art), so lines are filtered rather than
/// trusted wholesale — but the filter is structural (bracket prefixes, blank
/// lines), never a list of known model names.
pub async fn opencode_models(binary: &str) -> Vec<Model> {
    let Ok(Ok(output)) = timeout(LIST_TIMEOUT, Command::new(binary).arg("models").output()).await
    else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| is_plausible_model_line(line))
        .map(|id| {
            let mut model = Model::opaque(id, DiscoverySource::CliCommand);
            if let Some((prefix, _)) = id.split_once('/') {
                model = model.with_model_provider(prefix);
            }
            model
        })
        .collect()
}

/// Structural filter for a model id line. Rejects plugin/log chatter and banner
/// art without ever consulting a list of expected model names.
fn is_plausible_model_line(line: &str) -> bool {
    if line.is_empty() {
        return false;
    }
    // Log/plugin prefixes: "[opencode-mobile] Plugin init called"
    if line.starts_with('[') {
        return false;
    }
    // Banner art and progress glyphs: no ASCII alphanumerics at all.
    if !line.chars().any(|c| c.is_ascii_alphanumeric()) {
        return false;
    }
    // Model ids never contain whitespace; human-readable log lines do.
    if line.chars().any(char::is_whitespace) {
        return false;
    }
    true
}

/// Scrape model aliases out of a CLI's `--help` text.
///
/// This exists for claude, whose help documents aliases as quoted tokens inside
/// the `--model` paragraph. The paragraph *wraps*, and the quoted tokens land on
/// continuation lines that do not themselves contain `--model` — the previous
/// implementation only examined lines containing `--model` and therefore always
/// returned nothing. Real output:
///
/// ```text
///   --model <model>    Model for the current session. Provide
///                      an alias for the latest model (e.g.
///                      'fable', 'opus', or 'sonnet') or a
///                      model's full name (e.g.
///                      'claude-fable-5').
/// ```
///
/// So: find the flag, then keep reading continuation lines until the next
/// flag begins. Results are a hint, not an inventory.
pub async fn help_model_aliases(binary: &str) -> Vec<Model> {
    let Ok(Ok(output)) = timeout(HELP_TIMEOUT, Command::new(binary).arg("--help").output()).await
    else {
        return Vec::new();
    };
    // Some CLIs print help to stderr; check both.
    let mut help = String::from_utf8_lossy(&output.stdout).to_string();
    if help.trim().is_empty() {
        help = String::from_utf8_lossy(&output.stderr).to_string();
    }
    extract_quoted_aliases(&help)
        .into_iter()
        .map(|id| Model::opaque(id, DiscoverySource::CliHelp))
        .collect()
}

/// Effort levels a CLI really accepts, read off its own `--help`.
///
/// Parses the `--effort` paragraph's parenthesized list, e.g.
/// `--effort <level>  Effort level … (low, medium, high, xhigh, max)`.
/// Empty when the flag is absent (this CLI has no effort dimension — the
/// caller hides the knob) or unparseable. Order follows the help text.
pub async fn claude_effort_levels(binary: &str) -> Vec<String> {
    let Ok(Ok(output)) = timeout(HELP_TIMEOUT, Command::new(binary).arg("--help").output()).await
    else {
        return Vec::new();
    };
    let mut help = String::from_utf8_lossy(&output.stdout).to_string();
    if help.trim().is_empty() {
        help = String::from_utf8_lossy(&output.stderr).to_string();
    }
    extract_effort_levels(&help)
}

fn extract_effort_levels(help: &str) -> Vec<String> {
    let mut levels = Vec::new();
    let mut paragraph = String::new();
    let mut in_effort = false;
    for line in help.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with('-') {
            if in_effort {
                break;
            }
            // The flag may appear as `--effort <level>`; match the flag token.
            in_effort = trimmed.split_whitespace().next() == Some("--effort");
            if in_effort {
                paragraph.push_str(trimmed);
                paragraph.push('\n');
            }
            continue;
        }
        if trimmed.is_empty() {
            if in_effort {
                break;
            }
            continue;
        }
        if in_effort {
            paragraph.push_str(trimmed);
            paragraph.push(' ');
        }
    }
    // First parenthesized group is the level list.
    let Some(start) = paragraph.find('(') else { return levels };
    let Some(end) = paragraph[start..].find(')') else { return levels };
    for token in paragraph[start + 1..start + end].split(',') {
        let token = token.trim().trim_matches('"').trim_matches('\'').to_string();
        if !token.is_empty()
            && token.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            && !levels.contains(&token)
        {
            levels.push(token);
        }
    }
    levels
}

/// Pull single-quoted tokens from the `--model` paragraph, following wrapped
/// continuation lines.
fn extract_quoted_aliases(help: &str) -> Vec<String> {
    let mut aliases: Vec<String> = Vec::new();
    let mut in_model_paragraph = false;

    for line in help.lines() {
        let trimmed = line.trim_start();
        let starts_new_flag = trimmed.starts_with('-');

        if starts_new_flag {
            // A new flag ends the previous paragraph. `--model` opens ours.
            in_model_paragraph = trimmed.starts_with("--model") || trimmed.contains(" --model");
        } else if trimmed.is_empty() {
            in_model_paragraph = false;
        }

        if !in_model_paragraph {
            continue;
        }

        // Quoted tokens are the alias list. Odd indices are inside the quotes.
        for token in line.split('\'').skip(1).step_by(2) {
            let token = token.trim();
            if is_plausible_alias(token) && !aliases.iter().any(|existing| existing == token) {
                aliases.push(token.to_string());
            }
        }
    }
    aliases
}

/// A model alias is a short single token. Deliberately permissive about
/// punctuation (`claude-fable-5` must pass) and strict about whitespace.
fn is_plausible_alias(token: &str) -> bool {
    !token.is_empty()
        && token.len() <= 40
        && !token.chars().any(char::is_whitespace)
        && token.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' || c == '/')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_aliases_across_wrapped_help_lines() {
        // Verbatim shape of `claude --help`, where the aliases sit on
        // continuation lines that contain no `--model` token.
        let help = "\
  --fallback-model <model>              Enable automatic fallback
  --model <model>                       Model for the current session. Provide
                                        an alias for the latest model (e.g.
                                        'fable', 'opus', or 'sonnet') or a
                                        model's full name (e.g.
                                        'claude-fable-5').
  -n, --name <name>                     Set a display name for this session
";
        let aliases = extract_quoted_aliases(help);
        assert!(aliases.contains(&"fable".to_string()), "got {:?}", aliases);
        assert!(aliases.contains(&"opus".to_string()), "got {:?}", aliases);
        assert!(aliases.contains(&"sonnet".to_string()), "got {:?}", aliases);
        assert!(
            aliases.contains(&"claude-fable-5".to_string()),
            "a hyphenated full name must survive: {:?}",
            aliases
        );
    }

    #[test]
    fn stops_at_the_next_flag() {
        let help = "\
  --model <model>   Provide an alias (e.g. 'opus')
  --other <x>       Unrelated flag mentioning 'not-a-model'
";
        let aliases = extract_quoted_aliases(help);
        assert_eq!(aliases, vec!["opus"], "must not bleed into the next flag");
    }

    #[test]
    fn help_without_quoted_aliases_yields_nothing() {
        // codex: `-m, --model <MODEL>  Model the agent should use` — no aliases.
        let help = "  -m, --model <MODEL>\n          Model the agent should use\n";
        assert!(extract_quoted_aliases(help).is_empty());
    }

    #[test]
    fn model_line_filter_keeps_real_ids_and_drops_chatter() {
        // Real `opencode models` output, including the noise.
        let lines = [
            ("[opencode-mobile] v1.4.0", false),
            ("[opencode-mobile] Plugin init OK; skipping (not in 'serve' mode).", false),
            ("", false),
            ("█▀▀█ █▀▀█ █▀▀█", false),
            ("opencode/big-pickle", true),
            ("opencode-go/gpt-5.6-luna", true),
            ("omni/kr/claude-sonnet-4.5-thinking-agentic", true),
            (
                "localllm/downloaded:Jackrong/MLX-Qwen3.5-4B-Claude-4.6-Opus-Reasoning-Distilled-6bit",
                true,
            ),
        ];
        for (line, expected) in lines {
            assert_eq!(
                is_plausible_model_line(line),
                expected,
                "misclassified: {:?}",
                line
            );
        }
    }

    #[test]
    fn parses_effort_levels_from_help_paragraph() {
        let help = "  --effort <level>                      Effort level for the current session\n                                        (low, medium, high, xhigh, max)\n  --exclude-dynamic-system-prompt-sections\n                                        Move per-machine sections\n";
        assert_eq!(
            super::extract_effort_levels(help),
            vec!["low", "medium", "high", "xhigh", "max"]
        );
    }

    #[test]
    fn missing_effort_flag_yields_no_levels() {
        assert!(super::extract_effort_levels("--model <m>  Model to use\n").is_empty());
        assert!(super::extract_effort_levels("").is_empty());
    }

    #[test]
    fn wrapped_effort_paragraphs_still_parse() {
        let help = "  --effort <level>\n      Effort level\n      (low,\n      medium,\n      high)\n";
        assert_eq!(super::extract_effort_levels(help), vec!["low", "medium", "high"]);
    }

    #[test]
    fn alias_filter_rejects_prose_but_accepts_odd_ids() {
        assert!(is_plausible_alias("sonnet"));
        assert!(is_plausible_alias("claude-fable-5"));
        assert!(is_plausible_alias("my_fast"));
        assert!(!is_plausible_alias("the current session"));
        assert!(!is_plausible_alias(""));
        assert!(!is_plausible_alias("-flag"));
    }
}
