use crate::agent::types::LlmProvider;
use rig_core::client::ModelListingClient;

pub async fn list_provider_models(
    provider: LlmProvider,
    api_key: &str,
) -> Result<Vec<String>, String> {
    if api_key.trim().is_empty() {
        return Err("API key is required".into());
    }

    let models = match provider {
        LlmProvider::Deepseek => {
            use rig_core::providers::deepseek;
            let client = deepseek::Client::new(api_key).map_err(|e| e.to_string())?;
            list_rig_models(&client).await?
        }
        LlmProvider::Openai => {
            use rig_core::providers::openai;
            let client = openai::Client::new(api_key).map_err(|e| e.to_string())?;
            list_rig_models(&client).await?
        }
        LlmProvider::Anthropic => {
            use rig_core::providers::anthropic;
            let client = anthropic::Client::new(api_key).map_err(|e| e.to_string())?;
            list_rig_models(&client).await?
        }
        LlmProvider::Kimi => {
            list_openai_compatible_models("https://api.moonshot.ai/v1/models", api_key).await?
        }
        LlmProvider::Glm => {
            list_openai_compatible_models("https://api.z.ai/api/paas/v4/models", api_key).await?
        }
        LlmProvider::Grok => {
            list_openai_compatible_models("https://api.x.ai/v1/models", api_key).await?
        }
    };

    if models.is_empty() {
        return Err("No chat models returned from provider".into());
    }

    Ok(models)
}

async fn list_rig_models<C>(client: &C) -> Result<Vec<String>, String>
where
    C: ModelListingClient,
{
    let models = client.list_models().await.map_err(|e| e.to_string())?;
    let mut ids: Vec<String> = models.iter().map(|model| model.id.clone()).collect();
    ids = filter_chat_models(ids);
    ids.sort();
    ids.dedup();
    Ok(ids)
}

async fn list_openai_compatible_models(url: &str, api_key: &str) -> Result<Vec<String>, String> {
    let client = reqwest::Client::new();
    let response = client
        .get(url)
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Failed to list models ({status}): {body}"));
    }

    let body: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let mut ids: Vec<String> = body
        .get("data")
        .and_then(|data| data.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(|id| id.as_str()))
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();

    ids = filter_chat_models(ids);
    ids.sort();
    ids.dedup();
    Ok(ids)
}

fn filter_chat_models(models: Vec<String>) -> Vec<String> {
    models
        .into_iter()
        .filter(|id| is_likely_chat_model(id))
        .collect()
}

fn is_likely_chat_model(id: &str) -> bool {
    let lower = id.to_lowercase();
    const EXCLUDED: &[&str] = &[
        "embedding",
        "embed-",
        "tts",
        "whisper",
        "dall-e",
        "dalle",
        "-image",
        "image-",
        "moderation",
        "davinci",
        "babbage",
        "audio",
        "transcribe",
        "realtime",
        "search-api",
        "ocr",
        "sora",
    ];
    !EXCLUDED.iter().any(|needle| lower.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::is_likely_chat_model;

    #[test]
    fn filters_embedding_models() {
        assert!(!is_likely_chat_model("text-embedding-3-small"));
        assert!(is_likely_chat_model("gpt-4o-mini"));
    }
}
