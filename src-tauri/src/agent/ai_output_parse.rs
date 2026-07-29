use serde::Deserialize;

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct AiValidationFinding {
    pub status: String,
    pub message: String,
    #[serde(default)]
    pub affected: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct AiValidationResponse {
    #[serde(default)]
    items: Vec<AiValidationFinding>,
}

/// Parse AI validation JSON from raw model output (markdown fences, truncation, alternate shapes).
pub fn parse_ai_findings(raw: &str) -> Result<Vec<AiValidationFinding>, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("empty AI output".into());
    }

    let mut candidates = Vec::new();
    let stripped = strip_markdown_fences(trimmed);
    candidates.push(stripped.clone());
    if let Some(slice) = extract_outer_json_slice(&stripped) {
        candidates.push(slice);
    }
    candidates.push(close_unbalanced_json(&stripped));

    for candidate in dedupe_strings(candidates) {
        if let Ok(findings) = try_parse_findings(&candidate) {
            if !findings.is_empty() {
                return Ok(normalize_findings(findings));
            }
        }
    }

    if let Some(findings) = salvage_findings(trimmed) {
        if !findings.is_empty() {
            return Ok(normalize_findings(findings));
        }
    }

    Err("could not parse AI validation JSON".into())
}

fn try_parse_findings(text: &str) -> Result<Vec<AiValidationFinding>, serde_json::Error> {
    if let Ok(response) = serde_json::from_str::<AiValidationResponse>(text) {
        if !response.items.is_empty() {
            return Ok(response.items);
        }
    }

    if let Ok(items) = serde_json::from_str::<Vec<AiValidationFinding>>(text) {
        if !items.is_empty() {
            return Ok(items);
        }
    }

    if let Ok(item) = serde_json::from_str::<AiValidationFinding>(text) {
        if !item.message.trim().is_empty() {
            return Ok(vec![item]);
        }
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(text) {
        return findings_from_value(value);
    }

    serde_json::from_str::<AiValidationResponse>(text).map(|response| response.items)
}

fn findings_from_value(value: serde_json::Value) -> Result<Vec<AiValidationFinding>, serde_json::Error> {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(items) = map.get("items") {
                if let Ok(parsed) = serde_json::from_value::<Vec<AiValidationFinding>>(items.clone()) {
                    if !parsed.is_empty() {
                        return Ok(parsed);
                    }
                }
            }
            serde_json::from_value::<AiValidationFinding>(serde_json::Value::Object(map))
                .map(|item| vec![item])
        }
        serde_json::Value::Array(items) => {
            serde_json::from_value::<Vec<AiValidationFinding>>(serde_json::Value::Array(items))
        }
        _ => Err(serde_json::Error::io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "expected JSON object or array",
        ))),
    }
}

fn normalize_findings(findings: Vec<AiValidationFinding>) -> Vec<AiValidationFinding> {
    findings
        .into_iter()
        .map(|mut finding| {
            finding.status = finding.status.trim().to_lowercase();
            finding.message = finding.message.trim().to_string();
            finding.affected = finding
                .affected
                .into_iter()
                .map(|entry| entry.trim().to_string())
                .filter(|entry| !entry.is_empty() && !looks_like_json_blob(entry))
                .collect();
            finding
        })
        .filter(|finding| !finding.message.is_empty())
        .collect()
}

fn looks_like_json_blob(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.starts_with('{')
        || trimmed.starts_with('[')
        || trimmed.starts_with("```")
        || trimmed.contains("\"items\"")
}

fn strip_markdown_fences(text: &str) -> String {
    let mut trimmed = text.trim();
    if !trimmed.starts_with("```") {
        return trimmed.to_string();
    }

    if let Some(start) = trimmed.find('\n') {
        trimmed = &trimmed[start + 1..];
    }
    if let Some(end) = trimmed.rfind("```") {
        trimmed = &trimmed[..end];
    }
    trimmed.trim().to_string()
}

fn extract_outer_json_slice(text: &str) -> Option<String> {
    let start = text.find('{').or_else(|| text.find('['))?;
    let end = text.rfind('}').or_else(|| text.rfind(']'))?;
    if end <= start {
        return None;
    }
    Some(text[start..=end].to_string())
}

fn close_unbalanced_json(text: &str) -> String {
    let mut result = text.to_string();
    let mut in_string = false;
    let mut escape = false;
    let mut stack: Vec<char> = Vec::new();

    for ch in text.chars() {
        if escape {
            escape = false;
            continue;
        }
        if in_string {
            if ch == '\\' {
                escape = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' | '[' => stack.push(ch),
            '}' if stack.last() == Some(&'{') => {
                stack.pop();
            }
            ']' if stack.last() == Some(&'[') => {
                stack.pop();
            }
            '}' | ']' => {}
            _ => {}
        }
    }

    if in_string {
        result.push('"');
    }

    while let Some(open) = stack.pop() {
        result.push(match open {
            '{' => '}',
            '[' => ']',
            _ => '}',
        });
    }

    result
}

fn salvage_findings(text: &str) -> Option<Vec<AiValidationFinding>> {
    let mut findings = Vec::new();
    for object in extract_json_objects(text) {
        if !object.contains("\"status\"") || !object.contains("\"message\"") {
            continue;
        }
        let repaired = close_unbalanced_json(&object);
        if let Ok(item) = serde_json::from_str::<AiValidationFinding>(&repaired) {
            if !item.message.trim().is_empty() {
                findings.push(item);
            }
        }
    }

    if findings.is_empty() {
        None
    } else {
        Some(findings)
    }
}

fn extract_json_objects(text: &str) -> Vec<String> {
    let mut objects = Vec::new();
    let bytes = text.as_bytes();
    let mut index = 0usize;

    while index < bytes.len() {
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if index >= bytes.len() || bytes[index] != b'{' {
            index += 1;
            continue;
        }

        if let Some((object, next)) = read_json_object(text, index) {
            objects.push(object);
            index = next;
        } else {
            index += 1;
        }
    }

    objects
}

fn read_json_object(text: &str, start: usize) -> Option<(String, usize)> {
    let bytes = text.as_bytes();
    if bytes.get(start)? != &b'{' {
        return None;
    }

    let mut depth = 0usize;
    let mut in_string = false;
    let mut escape = false;

    for (offset, ch) in text[start..].char_indices() {
        let index = start + offset;
        if escape {
            escape = false;
            continue;
        }
        if in_string {
            if ch == '\\' {
                escape = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some((text[start..=index].to_string(), index + 1));
                }
            }
            _ => {}
        }
    }

    None
}

fn dedupe_strings(values: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    for value in values {
        if value.trim().is_empty() {
            continue;
        }
        if out.iter().any(|existing| existing == &value) {
            continue;
        }
        out.push(value);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_json_inside_markdown_fence() {
        let raw = r#"```json
{"items":[{"status":"pass","message":"ok","affected":["src/a.ts — detail"]}]}
```"#;
        let findings = parse_ai_findings(raw).expect("parse");
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].status, "pass");
        assert_eq!(findings[0].affected[0], "src/a.ts — detail");
    }

    #[test]
    fn parses_bare_array() {
        let raw = r#"[{"status":"warn","message":"issue","affected":[]}]"#;
        let findings = parse_ai_findings(raw).expect("parse");
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].status, "warn");
    }

    #[test]
    fn salvages_truncated_items_array() {
        let raw = r#"```json
{
"items": [
{
"status": "pass",
"message": "Layered architecture",
"affected": [
"api/routes/auth.py — routes call services",
"services/auth.py — business logic delegates"
"#;
        let findings = parse_ai_findings(raw).expect("parse truncated");
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].status, "pass");
        assert_eq!(findings[0].affected.len(), 2);
    }

    #[test]
    fn rejects_json_blob_as_affected_entry() {
        let raw = r#"{"items":[{"status":"warn","message":"bad","affected":["```json\n{\"x\":1}"]}]}"#;
        let findings = parse_ai_findings(raw).expect("parse");
        assert!(findings[0].affected.is_empty());
    }
}
