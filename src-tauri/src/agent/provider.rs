use std::net::IpAddr;
use std::time::Duration;

use github_copilot_sdk::ProviderConfig;
use reqwest::{redirect::Policy, Client, Url};
use serde::Deserialize;

use crate::error::CommandError;

use super::types::{AgentModelSettings, DiscoveredModel};

const MAX_MODEL_LIST_BYTES: usize = 1024 * 1024;
const MAX_MODEL_COUNT: usize = 2_000;
const MAX_MODEL_ID_BYTES: usize = 200;

#[derive(Debug, Deserialize)]
struct ModelListResponse {
    data: Vec<ModelListEntry>,
}

#[derive(Debug, Deserialize)]
struct ModelListEntry {
    id: String,
}

pub fn model_http_client() -> Result<Client, CommandError> {
    Client::builder()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(15))
        .user_agent("Preshot/0.0.1")
        .build()
        .map_err(|error| {
            CommandError::new(
                "agent_http_client_failed",
                format!("Unable to initialize the model probe client: {error}"),
            )
        })
}

fn is_loopback(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    host.parse::<IpAddr>()
        .is_ok_and(|address| address.is_loopback())
}

pub fn canonical_url(value: &str, field: &str) -> Result<Url, CommandError> {
    if value.is_empty() || value.trim() != value || value.len() > 2_048 {
        return Err(invalid_settings(format!(
            "{field} must be a non-empty trimmed URL"
        )));
    }
    if value.starts_with(r"\\")
        || value
            .as_bytes()
            .get(1)
            .is_some_and(|separator| *separator == b':')
    {
        return Err(invalid_settings(format!(
            "{field} must not be a file or UNC path"
        )));
    }

    let mut url =
        Url::parse(value).map_err(|_| invalid_settings(format!("{field} is not a valid URL")))?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(invalid_settings(format!(
            "{field} must not contain credentials"
        )));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(invalid_settings(format!(
            "{field} must not contain a query or fragment"
        )));
    }
    match url.scheme() {
        "https" => {}
        "http" if is_loopback(&url) => {}
        "http" => {
            return Err(invalid_settings(format!(
                "{field} may use HTTP only for a loopback host"
            )));
        }
        _ => {
            return Err(invalid_settings(format!(
                "{field} must use loopback HTTP or HTTPS"
            )));
        }
    }
    if url.host_str().is_none() {
        return Err(invalid_settings(format!("{field} must include a host")));
    }

    let path = url.path().trim_end_matches('/').to_string();
    url.set_path(if path.is_empty() { "/" } else { &path });
    Ok(url)
}

pub fn validate_settings(settings: &AgentModelSettings) -> Result<(Url, Url), CommandError> {
    if settings.provider_type != "openai" {
        return Err(invalid_settings("providerType must be openai"));
    }
    if settings.wire_api != "responses" {
        return Err(invalid_settings("wireApi must be responses"));
    }
    let display = canonical_url(&settings.display_url, "displayUrl")?;
    let api = canonical_url(&settings.api_base_url, "apiBaseUrl")?;
    if display.origin() != api.origin() {
        return Err(invalid_settings(
            "displayUrl and apiBaseUrl must use the same origin",
        ));
    }
    if !api.path().eq_ignore_ascii_case("/v1") && !api.path().to_ascii_lowercase().ends_with("/v1")
    {
        return Err(invalid_settings("apiBaseUrl must end in /v1"));
    }
    if api.as_str().trim_end_matches('/') != derive_api_base_url(&settings.display_url)? {
        return Err(invalid_settings(
            "apiBaseUrl must be the canonical /v1 root derived from displayUrl",
        ));
    }
    if let Some(model_id) = &settings.model_id {
        validate_model_id(model_id)?;
    }
    match settings.reasoning_effort.as_deref() {
        None | Some("low" | "medium" | "high" | "xhigh") => {}
        Some(_) => return Err(invalid_settings("reasoningEffort is unsupported")),
    }
    if !matches!(
        settings.reasoning_summary.as_str(),
        "none" | "concise" | "detailed"
    ) {
        return Err(invalid_settings("reasoningSummary is unsupported"));
    }
    Ok((display, api))
}

pub fn derive_api_base_url(display_url: &str) -> Result<String, CommandError> {
    let mut display = canonical_url(display_url, "displayUrl")?;
    if !display.path().to_ascii_lowercase().ends_with("/v1") {
        let path = format!("{}/v1", display.path().trim_end_matches('/'));
        display.set_path(&path);
    }
    Ok(display.as_str().trim_end_matches('/').to_string())
}

pub fn provider_config(
    settings: &AgentModelSettings,
    model_id: &str,
) -> Result<ProviderConfig, CommandError> {
    validate_settings(settings)?;
    validate_model_id(model_id)?;
    Ok(ProviderConfig::new(settings.api_base_url.clone())
        .with_provider_type("openai")
        .with_wire_api("responses")
        .with_transport("http")
        .with_model_id(model_id)
        .with_wire_model(model_id))
}

pub async fn list_models(
    client: &Client,
    settings: &AgentModelSettings,
) -> Result<Vec<DiscoveredModel>, CommandError> {
    let (_, mut api) = validate_settings(settings)?;
    api.set_path(&format!("{}/models", api.path().trim_end_matches('/')));

    let mut response = client.get(api).send().await.map_err(|error| {
        CommandError::new(
            "proxy_unreachable",
            format!("Unable to reach the configured model proxy: {error}"),
        )
    })?;
    if response.status().is_redirection() {
        return Err(CommandError::new(
            "invalid_model_list",
            "The model endpoint redirected; cross-endpoint redirects are not allowed",
        ));
    }
    if !response.status().is_success() {
        return Err(CommandError::new(
            "invalid_model_list",
            format!(
                "The model endpoint returned HTTP {}",
                response.status().as_u16()
            ),
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_MODEL_LIST_BYTES as u64)
    {
        return Err(CommandError::new(
            "invalid_model_list",
            "The model list response exceeded the 1 MiB limit",
        ));
    }

    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| {
        CommandError::new(
            "invalid_model_list",
            format!("Unable to read the model list response: {error}"),
        )
    })? {
        if bytes.len().saturating_add(chunk.len()) > MAX_MODEL_LIST_BYTES {
            return Err(CommandError::new(
                "invalid_model_list",
                "The model list response exceeded the 1 MiB limit",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }

    let parsed: ModelListResponse = serde_json::from_slice(&bytes).map_err(|error| {
        CommandError::new(
            "invalid_model_list",
            format!("The proxy returned an invalid OpenAI model list: {error}"),
        )
    })?;
    if parsed.data.is_empty() || parsed.data.len() > MAX_MODEL_COUNT {
        return Err(CommandError::new(
            "invalid_model_list",
            "The proxy returned an empty or excessively large model list",
        ));
    }

    let mut models = Vec::with_capacity(parsed.data.len());
    for entry in parsed.data {
        validate_model_id(&entry.id)?;
        models.push(DiscoveredModel {
            display_name: entry.id.clone(),
            id: entry.id,
        });
    }
    models.sort_by(|left, right| left.id.cmp(&right.id));
    models.dedup_by(|left, right| left.id == right.id);
    Ok(models)
}

pub fn validate_model_id(model_id: &str) -> Result<(), CommandError> {
    if model_id.is_empty()
        || model_id.trim() != model_id
        || model_id.len() > MAX_MODEL_ID_BYTES
        || model_id.chars().any(char::is_control)
    {
        return Err(CommandError::new(
            "model_unavailable",
            "The selected model identifier is invalid",
        ));
    }
    Ok(())
}

fn invalid_settings(message: impl Into<String>) -> CommandError {
    CommandError::new("model_not_configured", message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(display: &str, api: &str) -> AgentModelSettings {
        AgentModelSettings {
            enabled: true,
            provider_type: "openai".to_string(),
            display_url: display.to_string(),
            api_base_url: api.to_string(),
            model_id: Some("test-model".to_string()),
            wire_api: "responses".to_string(),
            reasoning_effort: None,
            reasoning_summary: "concise".to_string(),
        }
    }

    #[test]
    fn canonicalizes_supported_provider_urls() {
        assert_eq!(
            derive_api_base_url("http://localhost:4141/").unwrap(),
            "http://localhost:4141/v1"
        );
        assert!(validate_settings(&settings(
            "https://models.example.test/openai",
            "https://models.example.test/openai/v1"
        ))
        .is_ok());
    }

    #[test]
    fn rejects_remote_http_credentials_and_noncanonical_api_roots() {
        assert!(canonical_url("http://example.test", "displayUrl").is_err());
        assert!(canonical_url("https://user@example.test", "displayUrl").is_err());
        assert!(validate_settings(&settings(
            "https://example.test",
            "https://example.test/api"
        ))
        .is_err());
    }

    #[test]
    fn provider_is_keyless_openai_responses() {
        let settings = settings("http://127.0.0.1:4141", "http://127.0.0.1:4141/v1");
        let provider = provider_config(&settings, "test-model").unwrap();
        assert_eq!(provider.provider_type.as_deref(), Some("openai"));
        assert_eq!(provider.wire_api.as_deref(), Some("responses"));
        assert_eq!(provider.api_key, None);
        assert_eq!(provider.bearer_token, None);
        assert_eq!(provider.base_url, "http://127.0.0.1:4141/v1");
    }
}
