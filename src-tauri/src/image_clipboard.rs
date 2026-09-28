use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use uuid::Uuid;

use crate::error::CommandError;

mod codec;
#[cfg(windows)]
mod process;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod validation_tests;
#[cfg(windows)]
mod windows;

/// Must run before application/runtime initialization; the decoder worker has no app services.
pub fn run_codec_worker_if_requested() -> bool {
    #[cfg(windows)]
    {
        process::run_worker_if_requested()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Validates owned encoded image bytes without accessing the clipboard or project files.
/// Returns EXIF-oriented dimensions; the borrowed original encoding is never changed.
pub(crate) fn validate_encoded_image_dimensions(
    bytes: &[u8],
    mime_type: &str,
) -> Result<(u32, u32), CommandError> {
    codec::validated_dimensions(bytes, mime_type)
}

/// Render a project-owned native image without reading or publishing the clipboard.
pub(crate) fn render_encoded_image(
    bytes: &[u8],
    presentation: &Presentation,
) -> Result<Vec<u8>, CommandError> {
    codec::render_encoded(bytes, presentation)
}

const MIB: usize = 1024 * 1024;
const MAX_ENCODED: usize = 16 * MIB;
const MAX_SNAPSHOT: usize = 64 * MIB;

fn error(code: &str, message: &str) -> CommandError {
    CommandError::new(&format!("image_clipboard_{code}"), message)
}
fn invalid() -> CommandError {
    error("invalid", "图片剪贴板数据无效，请重新复制图片。")
}
fn oversized() -> CommandError {
    error(
        "oversized",
        "图片超过剪贴板安全限制（16 MiB、8192 像素或内存预算），请缩小图片后重试。",
    )
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Crop {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
enum FitMode {
    Cover,
    Stretch,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Presentation {
    #[serde(skip_serializing_if = "Option::is_none")]
    caption: Option<String>,
    aspect_ratio: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_height: Option<f64>,
    frame_width: f64,
    frame_height: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    frame_offset_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    frame_offset_y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fit_mode: Option<FitMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    crop: Option<Crop>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum Alignment {
    Left,
    Center,
    Right,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeProps {
    #[serde(skip_serializing_if = "Option::is_none")]
    caption: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text_alignment: Option<Alignment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    preview_width: Option<f64>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageClipboardInput {
    data_url: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    presentation: Option<Presentation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    native_props: Option<NativeProps>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageClipboardContents {
    original: ImageClipboardInput,
    rendered_data_url: String,
    animated: bool,
    external: bool,
    #[serde(skip)]
    lease: Option<ResponseLease>,
}

struct ResponseLease {
    bytes: usize,
    counter: Arc<AtomicUsize>,
}
impl Drop for ResponseLease {
    fn drop(&mut self) {
        self.counter.fetch_sub(self.bytes, Ordering::AcqRel);
    }
}

fn finite(value: f64, minimum: f64, maximum: f64) -> Result<(), CommandError> {
    if value.is_finite() && (minimum..=maximum).contains(&value) {
        Ok(())
    } else {
        Err(invalid())
    }
}
fn caption(value: &Option<String>) -> Result<(), CommandError> {
    if value
        .as_ref()
        .is_some_and(|v| v.encode_utf16().count() > 8192 || v.contains('\0'))
    {
        Err(invalid())
    } else {
        Ok(())
    }
}

impl ImageClipboardInput {
    fn validate(&self) -> Result<(), CommandError> {
        if self.data_url.len() > MAX_ENCODED.div_ceil(3) * 4 + 32 {
            return Err(oversized());
        }
        if self.name.trim().is_empty()
            || self.name.encode_utf16().count() > 255
            || self
                .name
                .chars()
                .any(|c| c.is_control() || "\\/:<>\"|?*".contains(c))
        {
            return Err(invalid());
        }
        if let Some(p) = &self.presentation {
            caption(&p.caption)?;
            for n in [p.aspect_ratio, p.frame_width, p.frame_height] {
                finite(n, 0.000001, 1_000_000.0)?;
            }
            for n in [p.source_width, p.source_height].into_iter().flatten() {
                finite(n, 1.0, 8192.0)?;
            }
            for n in [p.frame_offset_x, p.frame_offset_y].into_iter().flatten() {
                finite(n, -1_000_000.0, 1_000_000.0)?;
            }
            if let Some(c) = &p.crop {
                finite(c.x, 0.0, 1.0)?;
                finite(c.y, 0.0, 1.0)?;
                finite(c.width, 0.000001, 1.0)?;
                finite(c.height, 0.000001, 1.0)?;
                if c.x + c.width > 1.000001 || c.y + c.height > 1.000001 {
                    return Err(invalid());
                }
            }
        }
        if let Some(p) = &self.native_props {
            caption(&p.caption)?;
            if let Some(n) = p.preview_width {
                finite(n, 0.000001, 1_000_000.0)?;
            }
        }
        Ok(())
    }
}

#[derive(Serialize)]
struct Metadata {
    name: String,
    presentation: Option<Presentation>,
    native_props: Option<NativeProps>,
}

struct Snapshot {
    id: String,
    original: Vec<u8>,
    mime: &'static str,
    metadata: Metadata,
    rendered: Vec<u8>,
    animated: bool,
    integrity: [u8; 32],
}

impl Snapshot {
    fn new(prepared: codec::Prepared) -> Self {
        let mut snapshot = Self {
            id: Uuid::new_v4().to_string(),
            original: prepared.original,
            mime: prepared.mime,
            metadata: prepared.metadata,
            rendered: prepared.png,
            animated: prepared.animated,
            integrity: [0; 32],
        };
        snapshot.integrity = snapshot.digest();
        snapshot
    }
    fn digest(&self) -> [u8; 32] {
        let mut hash = Sha256::new();
        for bytes in [
            self.id.as_bytes(),
            self.mime.as_bytes(),
            &self.original,
            &self.rendered,
            &serde_json::to_vec(&self.metadata).expect("validated finite metadata"),
            &[u8::from(self.animated)],
        ] {
            hash.update((bytes.len() as u64).to_le_bytes());
            hash.update(bytes);
        }
        hash.finalize().into()
    }
    fn integrity_valid(&self) -> bool {
        self.digest() == self.integrity
    }
    fn retained_bytes(&self) -> usize {
        self.original.len() + self.rendered.len() + 64 * 1024
    }
    fn contents(&self, external: bool) -> ImageClipboardContents {
        ImageClipboardContents {
            original: ImageClipboardInput {
                data_url: format!(
                    "data:{};base64,{}",
                    self.mime,
                    STANDARD.encode(&self.original)
                ),
                name: self.metadata.name.clone(),
                presentation: self.metadata.presentation.clone(),
                native_props: self.metadata.native_props.clone(),
            },
            rendered_data_url: format!("data:image/png;base64,{}", STANDARD.encode(&self.rendered)),
            animated: self.animated,
            external,
            lease: None,
        }
    }
}

#[derive(Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Packet {
    version: u8,
    process_nonce: String,
    snapshot_id: String,
}
impl Packet {
    fn new(process_nonce: String, snapshot_id: String) -> Self {
        Self {
            version: 1,
            process_nonce,
            snapshot_id,
        }
    }
}

struct Receipt {
    sequence: u32,
    generation: u64,
    packet: Packet,
    snapshot: Snapshot,
}
impl Receipt {
    fn matches(
        &self,
        nonce: &str,
        sequence: u32,
        generation: u64,
        packet: &[u8],
        png: &[u8],
    ) -> bool {
        sequence != 0
            && sequence == self.sequence
            && generation == self.generation
            && packet.len() <= 512
            && self.packet.process_nonce == nonce
            && serde_json::from_slice::<Packet>(packet).is_ok_and(|p| p == self.packet)
            && self.packet.snapshot_id == self.snapshot.id
            && Sha256::digest(png).as_slice() == Sha256::digest(&self.snapshot.rendered).as_slice()
            && self.snapshot.integrity_valid()
    }
}

enum Raster {
    Png(Vec<u8>),
    Dib(Vec<u8>),
}
struct ClipboardRead {
    sequence: u32,
    generation: u64,
    packet: Option<Vec<u8>>,
    raster: Option<Raster>,
}

trait ClipboardBackend {
    fn identity(&self) -> Result<(u32, u64), CommandError>;
    fn publish(
        &mut self,
        packet: &[u8],
        png: &[u8],
        dib: &[u8],
    ) -> Result<(u32, u64), CommandError>;
    fn read(&mut self, retained: usize) -> Result<ClipboardRead, CommandError>;
    fn has_image(&mut self) -> Result<bool, CommandError>;
}

struct Engine {
    nonce: String,
    current: Option<Receipt>,
    in_flight: Arc<AtomicUsize>,
}
impl Default for Engine {
    fn default() -> Self {
        Self {
            nonce: Uuid::new_v4().to_string(),
            current: None,
            in_flight: Arc::default(),
        }
    }
}
impl Engine {
    fn pin(&self, mut contents: ImageClipboardContents) -> Result<Response, CommandError> {
        // Keep IPC serialization plus the returned immutable strings charged until Tauri
        // has serialized/dropped the response, even if another native operation has begun.
        let bytes =
            2 * (contents.original.data_url.len() + contents.rendered_data_url.len() + 64 * 1024);
        let retained = self.in_flight.load(Ordering::Acquire);
        if bytes + retained > 128 * MIB {
            return Err(error("busy", "上一张剪贴板图片仍在传输，请稍候再试。"));
        }
        self.in_flight.fetch_add(bytes, Ordering::AcqRel);
        contents.lease = Some(ResponseLease {
            bytes,
            counter: self.in_flight.clone(),
        });
        Ok(Response::Contents(Some(contents)))
    }
    fn reconcile(&mut self, identity: Result<(u32, u64), CommandError>) {
        if self.current.as_ref().is_some_and(|r| {
            identity.as_ref().map_or(true, |&(sequence, generation)| {
                sequence == 0 || sequence != r.sequence || generation != r.generation
            })
        }) {
            self.current = None;
        }
    }
    fn execute(
        &mut self,
        backend: &mut impl ClipboardBackend,
        request: Request,
    ) -> Result<Response, CommandError> {
        self.reconcile(backend.identity());
        match request {
            Request::Write(input) => {
                let retained = self
                    .current
                    .as_ref()
                    .map_or(0, |r| r.snapshot.retained_bytes());
                let mut prepared =
                    codec::prepare(input, retained + self.in_flight.load(Ordering::Acquire))?;
                let dib = std::mem::take(&mut prepared.dib);
                let snapshot = Snapshot::new(prepared);
                if snapshot.retained_bytes() + retained > MAX_SNAPSHOT {
                    return Err(oversized());
                }
                let packet = Packet::new(self.nonce.clone(), snapshot.id.clone());
                let bytes = serde_json::to_vec(&packet).map_err(|_| invalid())?;
                // An attempted publication may empty the clipboard before a later format fails.
                self.current = None;
                let (sequence, generation) = backend.publish(&bytes, &snapshot.rendered, &dib)?;
                if sequence == 0 {
                    return Err(error("access", "无法确认系统剪贴板状态，请重新复制。"));
                }
                self.current = Some(Receipt {
                    sequence,
                    generation,
                    packet,
                    snapshot,
                });
                Ok(Response::Written)
            }
            Request::Read => {
                let cached = self
                    .current
                    .as_ref()
                    .map_or(0, |r| r.snapshot.retained_bytes());
                let live = backend.read(cached + self.in_flight.load(Ordering::Acquire))?;
                if live.sequence == 0 {
                    self.current = None;
                    return Err(error("access", "无法读取系统剪贴板状态，请重试。"));
                }
                if let (Some(receipt), Some(packet), Some(Raster::Png(png))) =
                    (&self.current, &live.packet, &live.raster)
                {
                    if receipt.matches(&self.nonce, live.sequence, live.generation, packet, png) {
                        return self.pin(receipt.snapshot.contents(false));
                    }
                }
                self.current = None;
                match live.raster {
                    Some(raster) => self.pin(codec::external(
                        raster,
                        self.in_flight.load(Ordering::Acquire),
                    )?),
                    None if live.packet.is_some() => Err(error(
                        "unsupported",
                        "此图片剪贴板内容已失效且没有可用位图，请重新复制原图片。",
                    )),
                    None => Ok(Response::Contents(None)),
                }
            }
            Request::HasImage => Ok(Response::HasImage(backend.has_image()?)),
        }
    }
}

enum Request {
    Write(ImageClipboardInput),
    Read,
    HasImage,
}
enum Response {
    Written,
    Contents(Option<ImageClipboardContents>),
    HasImage(bool),
}

#[derive(Clone, Default)]
pub struct ImageClipboardState {
    #[cfg(windows)]
    worker: Arc<OnceLock<Result<windows::Worker, CommandError>>>,
}
impl ImageClipboardState {
    fn execute(&self, request: Request) -> Result<Response, CommandError> {
        #[cfg(windows)]
        {
            self.worker
                .get_or_init(windows::Worker::start)
                .as_ref()
                .map_err(Clone::clone)?
                .execute(request)
        }
        #[cfg(not(windows))]
        {
            let _ = request;
            Err(error("unavailable", "当前系统不支持 Windows 图片剪贴板。"))
        }
    }
}

async fn dispatch(state: ImageClipboardState, request: Request) -> Result<Response, CommandError> {
    tauri::async_runtime::spawn_blocking(move || state.execute(request))
        .await
        .map_err(|_| error("worker", "图片剪贴板处理失败，请重新启动应用后重试。"))?
}

#[tauri::command]
pub async fn image_clipboard_write(
    image: ImageClipboardInput,
    state: tauri::State<'_, ImageClipboardState>,
) -> Result<(), CommandError> {
    image.validate()?;
    match dispatch(state.inner().clone(), Request::Write(image)).await? {
        Response::Written => Ok(()),
        _ => Err(invalid()),
    }
}
#[tauri::command]
pub async fn image_clipboard_read(
    state: tauri::State<'_, ImageClipboardState>,
) -> Result<Option<ImageClipboardContents>, CommandError> {
    match dispatch(state.inner().clone(), Request::Read).await? {
        Response::Contents(contents) => Ok(contents),
        _ => Err(invalid()),
    }
}
#[tauri::command]
pub async fn image_clipboard_has_image(
    state: tauri::State<'_, ImageClipboardState>,
) -> Result<bool, CommandError> {
    match dispatch(state.inner().clone(), Request::HasImage).await? {
        Response::HasImage(value) => Ok(value),
        _ => Err(invalid()),
    }
}
