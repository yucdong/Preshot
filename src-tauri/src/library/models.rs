use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum MaterialKind {
    #[serde(rename = "image")]
    Image,
    #[serde(rename = "imageGroup")]
    ImageGroup,
    #[serde(rename = "shootingLocation")]
    ShootingLocation,
    #[serde(rename = "modelCard")]
    ModelCard,
    #[serde(rename = "prop")]
    Prop,
    #[serde(rename = "clothing")]
    Clothing,
}

impl MaterialKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::ImageGroup => "imageGroup",
            Self::ShootingLocation => "shootingLocation",
            Self::ModelCard => "modelCard",
            Self::Prop => "prop",
            Self::Clothing => "clothing",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialPayload {
    pub format: String,
    pub version: u32,
    pub kind: MaterialKind,
    // Validated against a closed, kind-specific schema before any I/O.
    pub component: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialImageSource {
    pub local_image_id: String,
    pub file: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialSnapshot {
    pub source_block_id: String,
    pub payload: MaterialPayload,
    pub sources: Vec<MaterialImageSource>,
    pub omitted_legacy_images: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialMetadata {
    pub name: String,
    pub description: String,
    pub tags: Vec<String>,
    pub favorite: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialSummary {
    #[serde(flatten)]
    pub metadata: MaterialMetadata,
    pub id: String,
    pub kind: MaterialKind,
    pub revision: u32,
    pub metadata_version: u32,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub image_count: usize,
    pub byte_length: u64,
    pub preview_state: PreviewState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_partial: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PreviewState {
    Pending,
    Ready,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialImage {
    pub local_image_id: String,
    pub blob_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "present_storage_id")]
    pub storage_id: Option<String>,
    pub mime_type: String,
    pub byte_length: u64,
    pub width: u32,
    pub height: u32,
}

fn present_storage_id<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where D: serde::Deserializer<'de> {
    String::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialEditImageData {
    pub name: String,
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialDetail {
    #[serde(flatten)]
    pub summary: MaterialSummary,
    pub payload: MaterialPayload,
    pub images: Vec<MaterialImage>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialEditSession {
    pub session_id: String,
    pub material: MaterialDetail,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_new: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialEditImage {
    pub local_image_id: String,
    pub mime_type: String,
    pub byte_length: u64,
    pub width: u32,
    pub height: u32,
    pub data_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub presentation_axes: Option<crate::original_image::PresentationAxes>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_height: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialContentUpdate {
    pub operation_id: String,
    pub session_id: String,
    pub payload: MaterialPayload,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_metadata_update"
    )]
    pub metadata_update: Option<MaterialMetadataUpdate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialMetadataUpdate {
    pub expected_version: u32,
    pub metadata: MaterialMetadata,
}

fn present_metadata_update<'de, D>(
    deserializer: D,
) -> Result<Option<MaterialMetadataUpdate>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    MaterialMetadataUpdate::deserialize(deserializer).map(Some)
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialEditCropBounds {
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
}

// Categories may combine legacy payload kinds without rewriting immutable
// content, pinned edit sessions, or exact insertion/save receipts.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MaterialCategory {
    Image,
    ImageGroup,
    ShootingLocation,
    ModelCard,
    #[serde(alias = "prop", alias = "clothing")]
    PropClothing,
}

impl MaterialCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::ImageGroup => "imageGroup",
            Self::ShootingLocation => "shootingLocation",
            Self::ModelCard => "modelCard",
            Self::PropClothing => "propClothing",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialSearch {
    pub query: String,
    pub images_only: Option<bool>,
    pub exact_name: Option<String>,
    pub kind: Option<MaterialCategory>,
    pub favorites: Option<bool>,
    pub trash: Option<bool>,
    pub sort: SearchSort,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchSort {
    Relevance,
    Recent,
    Name,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialSearchResult {
    pub items: Vec<MaterialSummary>,
    pub total: usize,
    pub index_state: &'static str,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialSaveRequest {
    pub operation_id: String,
    pub project_id: String,
    pub project_path: String,
    pub expected_plan: Value,
    pub snapshot: MaterialSnapshot,
    pub metadata: MaterialMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialInsertRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_group_id: Option<String>,
    pub operation_id: String,
    pub material_id: String,
    pub revision: u32,
    pub project_id: String,
    pub project_path: String,
    pub expected_plan: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection: Option<MaterialImageSelection>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialImageSelection {
    pub image_ids: Vec<String>,
    pub mode: MaterialImageInsertMode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MaterialImageInsertMode { ImageGroup, Images }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedMaterialInsert {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_group_id: Option<String>,
    pub operation_id: String,
    pub material_id: String,
    pub revision: u32,
    pub payload: MaterialPayload,
    pub images: Vec<MaterialImageSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection: Option<MaterialImageSelection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialInsertCommit {
    pub operation_id: String,
    pub project_id: String,
    pub project_path: String,
    pub expected_plan: Value,
    pub next_plan: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MaterialInsertStatus {
    Prepared,
    Committed,
    Cancelled,
    Conflict,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialPreviewInput {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub render_key: String,
    pub is_partial: bool,
}
