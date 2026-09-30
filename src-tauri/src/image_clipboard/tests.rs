use super::*;

pub(super) fn input() -> ImageClipboardInput {
    ImageClipboardInput {
        data_url: format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(
                codec::encode_png(&image::RgbaImage::from_pixel(
                    2,
                    1,
                    image::Rgba([255, 0, 0, 128])
                ))
                .unwrap()
            )
        ),
        name: "照片.png".into(),
        presentation: None,
        native_props: None,
    }
}

#[test]
fn validates_closed_metadata_and_never_accepts_paths() {
    let mut value = serde_json::to_value(input()).unwrap();
    value["sourcePath"] = "C:\\private\\image.png".into();
    assert!(serde_json::from_value::<ImageClipboardInput>(value).is_err());
    let mut value = input();
    value.name = "C:\\private\\image.png".into();
    assert!(value.validate().is_err());
}

#[test]
fn source_snapshot_owns_bytes_and_packet_contains_only_opaque_identity() {
    let source = input();
    let expected = source.data_url.clone();
    let prepared = codec::prepare(source, 0).unwrap();
    let snapshot = Snapshot::new(prepared);
    let packet = Packet::new("process".into(), snapshot.id.clone());
    let json = serde_json::to_value(&packet).unwrap();
    assert_eq!(json.as_object().unwrap().len(), 3);
    assert!(json.get("dataUrl").is_none());
    assert!(json.get("name").is_none());
    assert_eq!(snapshot.contents(false).original.data_url, expected);
    assert!(snapshot.integrity_valid());
}

#[test]
fn rejects_stale_forged_and_zero_sequence_receipts() {
    let snapshot = Snapshot::new(codec::prepare(input(), 0).unwrap());
    let packet = Packet::new("process".into(), snapshot.id.clone());
    let mut receipt = Receipt {
        sequence: 42,
        generation: 7,
        snapshot,
        packet,
    };
    let live = serde_json::to_vec(&receipt.packet).unwrap();
    let png = receipt.snapshot.rendered.as_slice();
    assert!(receipt.matches("process", 42, 7, &live, png));
    assert!(!receipt.matches("process", 0, 7, &live, png));
    assert!(!receipt.matches("other-process", 42, 7, &live, png));
    assert!(!receipt.matches("process", 43, 7, &live, png));
    assert!(!receipt.matches("process", 42, 8, &live, png));
    assert!(!receipt.matches("process", 42, 7, b"{}", png));
    assert!(!receipt.matches("process", 42, 7, &live, b"replaced"));
    receipt.snapshot.original[0] ^= 1;
    assert!(!receipt.matches("process", 42, 7, &live, &receipt.snapshot.rendered));
}

#[test]
fn decode_and_operation_limits_fail_before_large_allocations() {
    assert!(codec::check_dimensions(8193, 1).is_err());
    assert!(codec::check_dimensions(8192, 8192).is_err());
    assert!(codec::check_dimensions(0, 1).is_err());
    assert!(codec::check_budget(32_000_000, 32_000_000, 16 * MIB, 32 * MIB, 0).is_err());
    let mut bad = input();
    bad.data_url = "data:image/jpeg;base64,iVBORw0KGgo=".into();
    assert!(codec::prepare(bad, 0).is_err());
}

#[test]
fn public_dib_is_top_down_bgra_with_alpha_masks_and_srgb() {
    let rgba = image::RgbaImage::from_raw(1, 2, vec![255, 0, 0, 128, 0, 0, 255, 255]).unwrap();
    let dib = codec::encode_dib(rgba);
    assert_eq!(i32::from_le_bytes(dib[8..12].try_into().unwrap()), -2);
    assert_eq!(
        u32::from_le_bytes(dib[52..56].try_into().unwrap()),
        0xff000000
    );
    assert_eq!(
        u32::from_le_bytes(dib[56..60].try_into().unwrap()),
        0x73524742
    );
    assert_eq!(&dib[124..], &[0, 0, 255, 128, 255, 0, 0, 255]);
    let decoded = codec::decode_dib(&dib).unwrap();
    assert_eq!(decoded.get_pixel(0, 0).0, [255, 0, 0, 128]);
    assert_eq!(decoded.get_pixel(0, 1).0, [0, 0, 255, 255]);
}

#[derive(Default)]
struct FakeClipboard {
    sequence: u32,
    generation: u64,
    packet: Option<Vec<u8>>,
    png: Option<Vec<u8>>,
    dib: Option<Vec<u8>>,
    publications: usize,
    fail_publish: bool,
    fail_read: bool,
}
impl ClipboardBackend for FakeClipboard {
    fn identity(&self) -> Result<(u32, u64), CommandError> {
        Ok((self.sequence, self.generation))
    }
    fn publish(
        &mut self,
        packet: &[u8],
        png: &[u8],
        dib: &[u8],
    ) -> Result<(u32, u64), CommandError> {
        self.publications += 1;
        self.sequence += 1;
        self.generation += 1;
        self.png = Some(png.to_vec());
        self.dib = None;
        self.packet = None;
        if self.fail_publish {
            return Err(error("publish", "复制未完成，请重试。"));
        }
        self.dib = Some(dib.to_vec());
        self.packet = Some(packet.to_vec());
        self.identity()
    }
    fn read(&mut self, _retained: usize) -> Result<ClipboardRead, CommandError> {
        if self.fail_read {
            return Err(error("locked", "剪贴板被占用，请重试。"));
        }
        Ok(ClipboardRead {
            sequence: self.sequence,
            generation: self.generation,
            packet: self.packet.clone(),
            raster: self.png.clone().map(Raster::Png),
        })
    }
    fn has_image(&mut self) -> Result<bool, CommandError> {
        Ok(self.png.is_some() || self.dib.is_some())
    }
}
fn read(engine: &mut Engine, clipboard: &mut FakeClipboard) -> ImageClipboardContents {
    match engine.execute(clipboard, Request::Read).unwrap() {
        Response::Contents(Some(contents)) => contents,
        _ => panic!("expected image"),
    }
}

#[test]
fn one_publication_keeps_original_and_all_three_formats() {
    let mut engine = Engine::default();
    let mut clipboard = FakeClipboard::default();
    let source = input();
    let expected = source.data_url.clone();
    engine
        .execute(&mut clipboard, Request::Write(source))
        .unwrap();
    assert_eq!(clipboard.publications, 1);
    assert!(clipboard.packet.is_some() && clipboard.png.is_some() && clipboard.dib.is_some());
    let frozen = read(&mut engine, &mut clipboard);
    assert_eq!(frozen.original.data_url, expected);
    assert!(!frozen.external);
    assert!(engine.in_flight.load(Ordering::Acquire) > 0);
    engine
        .execute(&mut clipboard, Request::Write(input()))
        .unwrap();
    assert_eq!(frozen.original.data_url, expected);
    drop(frozen);
    assert_eq!(engine.in_flight.load(Ordering::Acquire), 0);
}

#[test]
fn replay_after_overwrite_sequence_wrap_or_restart_falls_back_to_actual_standard_pixels() {
    let mut engine = Engine::default();
    let mut clipboard = FakeClipboard::default();
    engine
        .execute(&mut clipboard, Request::Write(input()))
        .unwrap();
    clipboard.generation += 1;
    assert!(read(&mut engine, &mut clipboard).external);
    assert!(engine.current.is_none());
    engine
        .execute(&mut clipboard, Request::Write(input()))
        .unwrap();
    assert!(read(&mut Engine::default(), &mut clipboard).external);
    clipboard.packet = Some(b"{\"version\":1,\"sourcePath\":\"C:\\\\secret\"}".to_vec());
    assert!(read(&mut engine, &mut clipboard).external);
}

#[test]
fn preparation_failure_preserves_receipt_but_partial_publication_invalidates_it() {
    let mut engine = Engine::default();
    let mut clipboard = FakeClipboard::default();
    engine
        .execute(&mut clipboard, Request::Write(input()))
        .unwrap();
    let mut invalid_input = input();
    invalid_input.data_url = "file:///not-authorized".into();
    assert!(engine
        .execute(&mut clipboard, Request::Write(invalid_input))
        .is_err());
    assert!(engine.current.is_some());
    assert_eq!(clipboard.publications, 1);
    clipboard.fail_publish = true;
    assert!(engine
        .execute(&mut clipboard, Request::Write(input()))
        .is_err());
    assert!(engine.current.is_none());
    assert!(clipboard.png.is_some() && clipboard.packet.is_none());
    assert!(read(&mut engine, &mut clipboard).external);
}

#[test]
fn empty_clipboard_is_distinct_from_invalid_private_only_lock_and_sequence_failures() {
    let mut engine = Engine::default();
    let mut clipboard = FakeClipboard {
        sequence: 1,
        ..Default::default()
    };
    assert!(matches!(
        engine.execute(&mut clipboard, Request::Read).unwrap(),
        Response::Contents(None)
    ));
    clipboard.packet = Some(b"{}".to_vec());
    assert_eq!(
        engine
            .execute(&mut clipboard, Request::Read)
            .err()
            .unwrap()
            .code,
        "image_clipboard_unsupported"
    );
    clipboard.fail_read = true;
    assert_eq!(
        engine
            .execute(&mut clipboard, Request::Read)
            .err()
            .unwrap()
            .code,
        "image_clipboard_locked"
    );
    clipboard.fail_read = false;
    clipboard.sequence = 0;
    assert_eq!(
        engine
            .execute(&mut clipboard, Request::Read)
            .err()
            .unwrap()
            .code,
        "image_clipboard_access"
    );
}

#[test]
fn clipboard_change_listener_retires_idle_snapshot_and_does_not_trust_zero() {
    let mut engine = Engine::default();
    let mut clipboard = FakeClipboard::default();
    engine
        .execute(&mut clipboard, Request::Write(input()))
        .unwrap();
    engine.reconcile(Ok((0, clipboard.generation)));
    assert!(engine.current.is_none());
    engine
        .execute(&mut clipboard, Request::Write(input()))
        .unwrap();
    engine.reconcile(Ok((clipboard.sequence, clipboard.generation + 1)));
    assert!(engine.current.is_none());
}

fn presentation(value: serde_json::Value) -> Presentation {
    serde_json::from_value(value).unwrap()
}

#[test]
fn gallery_render_reuses_centered_cover_explicit_crop_and_stretch_without_upscaling() {
    let source = image::RgbaImage::from_fn(4, 2, |x, _| image::Rgba([x as u8 * 60, 0, 0, 255]));
    let p = presentation(
        serde_json::json!({ "aspectRatio": 2, "frameWidth": 2000, "frameHeight": 2000 }),
    );
    let cover = codec::render(source.clone(), Some(&p)).unwrap();
    assert_eq!(cover.dimensions(), (2, 2));
    assert_eq!(cover.get_pixel(0, 0).0[0], 60);
    assert_eq!(cover.get_pixel(1, 0).0[0], 120);
    let p = presentation(serde_json::json!({
        "aspectRatio": 2, "frameWidth": 100, "frameHeight": 100,
        "crop": { "x": 0, "y": 0, "width": 0.5, "height": 1 }
    }));
    let crop = codec::render(source.clone(), Some(&p)).unwrap();
    assert_eq!(crop.dimensions(), (2, 2));
    assert_eq!(crop.get_pixel(0, 0).0[0], 0);
    let p = presentation(serde_json::json!({
        "aspectRatio": 2, "frameWidth": 100, "frameHeight": 200, "fitMode": "stretch",
        "crop": { "x": 0, "y": 0, "width": 0.5, "height": 1 }
    }));
    let stretch = codec::render(source, Some(&p)).unwrap();
    assert_eq!(stretch.dimensions(), (1, 2));
    assert_eq!(stretch.get_pixel(0, 0).0[0], 90);
}

#[test]
fn native_material_encoding_preserves_originals_and_bakes_only_visual_transforms() {
    let source = image::RgbaImage::from_fn(4, 2, |x, _| image::Rgba([x as u8 * 60, 0, 0, 255]));
    let bytes = codec::encode_png(&source).unwrap();
    let unchanged = presentation(serde_json::json!({"aspectRatio":2,"frameWidth":300,"frameHeight":150}));
    assert_eq!(render_encoded_image(&bytes, &unchanged, MAX_ENCODED).unwrap(), bytes);
    for (visual, dimensions, first_red) in [
        (serde_json::json!({"aspectRatio":2,"frameWidth":100,"frameHeight":100}), (2, 2), 60),
        (serde_json::json!({"aspectRatio":2,"frameWidth":100,"frameHeight":100,"crop":{"x":0,"y":0,"width":0.5,"height":1}}), (2, 2), 0),
        (serde_json::json!({"aspectRatio":2,"frameWidth":100,"frameHeight":200,"fitMode":"stretch"}), (1, 2), 90),
    ] {
        let p = presentation(visual);
        let encoded = render_encoded_image(&bytes, &p, MAX_ENCODED).unwrap();
        let decoded = image::load_from_memory(&encoded).unwrap().into_rgba8();
        assert_eq!(decoded.dimensions(), dimensions);
        assert_eq!(decoded.get_pixel(0, 0).0, [first_red, 0, 0, 255]);
    }
}

#[test]
fn alpha_compositing_does_not_add_dark_halos() {
    let source = image::RgbaImage::from_raw(2, 1, vec![255, 0, 0, 255, 0, 0, 0, 0]).unwrap();
    let p = presentation(
        serde_json::json!({ "aspectRatio": 2, "frameWidth": 1, "frameHeight": 1, "fitMode": "stretch" }),
    );
    let rgba = codec::render(source, Some(&p)).unwrap();
    assert_eq!(rgba.get_pixel(0, 0).0, [255, 0, 0, 128]);
}

fn encoded_input(mime: &str, bytes: &[u8]) -> ImageClipboardInput {
    ImageClipboardInput {
        data_url: format!("data:{mime};base64,{}", STANDARD.encode(bytes)),
        ..input()
    }
}
#[test]
fn gif_animation_preserves_original_bytes_but_publishes_deterministic_first_frame() {
    let mut bytes = Vec::new();
    {
        let mut encoder = image::codecs::gif::GifEncoder::new(&mut bytes);
        for color in [[255, 0, 0, 255], [0, 255, 0, 255]] {
            encoder
                .encode_frame(image::Frame::new(image::RgbaImage::from_pixel(
                    2,
                    1,
                    image::Rgba(color),
                )))
                .unwrap();
        }
    }
    let prepared = codec::prepare(encoded_input("image/gif", &bytes), 0).unwrap();
    assert!(prepared.animated);
    assert_eq!(prepared.original, bytes);
    let public = image::load_from_memory(&prepared.png).unwrap().into_rgba8();
    assert_eq!(public.get_pixel(0, 0).0, [255, 0, 0, 255]);
}

fn webp(color: [u8; 4]) -> Vec<u8> {
    let mut bytes = Vec::new();
    image::codecs::webp::WebPEncoder::new_lossless(&mut bytes)
        .encode(&color.repeat(2), 2, 1, image::ExtendedColorType::Rgba8)
        .unwrap();
    bytes
}
fn chunk(kind: &[u8; 4], bytes: &[u8]) -> Vec<u8> {
    let mut out = kind.to_vec();
    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(bytes);
    if bytes.len() % 2 != 0 {
        out.push(0);
    }
    out
}
#[test]
fn static_and_animated_webp_keep_originals_and_render_only_the_first_frame() {
    let red = webp([255, 0, 0, 255]);
    let prepared = codec::prepare(encoded_input("image/webp", &red), 0).unwrap();
    assert!(!prepared.animated);
    assert_eq!(prepared.original, red);
    let mut body = b"WEBP".to_vec();
    body.extend(chunk(b"VP8X", &[2, 0, 0, 0, 1, 0, 0, 0, 0, 0]));
    body.extend(chunk(b"ANIM", &[0; 6]));
    for bytes in [&red, &webp([0, 255, 0, 255])] {
        let mut frame = vec![0; 16];
        frame[6] = 1;
        frame[12] = 1;
        frame[15] = 2;
        frame.extend_from_slice(&bytes[12..]);
        body.extend(chunk(b"ANMF", &frame));
    }
    let mut animated = b"RIFF".to_vec();
    animated.extend_from_slice(&(body.len() as u32).to_le_bytes());
    animated.extend(body);
    let prepared = codec::prepare(encoded_input("image/webp", &animated), 0).unwrap();
    assert!(prepared.animated);
    assert_eq!(prepared.original, animated);
    let first = image::load_from_memory(&prepared.png).unwrap().into_rgba8();
    assert_eq!(first.get_pixel(0, 0).0, [255, 0, 0, 255]);
}

#[test]
fn jpeg_original_is_not_recompressed_and_exif_orientation_is_normalized_publicly() {
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 95)
        .encode(
            &[255, 0, 0, 0, 255, 0],
            2,
            1,
            image::ExtendedColorType::Rgb8,
        )
        .unwrap();
    let mut exif =
        b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0".to_vec();
    let length = (exif.len() + 2) as u16;
    let mut oriented = jpeg[..2].to_vec();
    oriented.extend_from_slice(&[0xff, 0xe1]);
    oriented.extend_from_slice(&length.to_be_bytes());
    oriented.append(&mut exif);
    oriented.extend_from_slice(&jpeg[2..]);
    let prepared = codec::prepare(encoded_input("image/jpeg", &oriented), 0).unwrap();
    assert_eq!(prepared.original, oriented);
    assert_eq!(
        image::load_from_memory(&prepared.png)
            .unwrap()
            .into_rgba8()
            .dimensions(),
        (1, 2)
    );
}

#[test]
fn external_bottom_up_24bit_dib_and_undefined_32bit_alpha_are_normalized() {
    let mut dib = vec![0; 48];
    dib[0..4].copy_from_slice(&40u32.to_le_bytes());
    dib[4..8].copy_from_slice(&1u32.to_le_bytes());
    dib[8..12].copy_from_slice(&2u32.to_le_bytes());
    dib[12..14].copy_from_slice(&1u16.to_le_bytes());
    dib[14..16].copy_from_slice(&24u16.to_le_bytes());
    dib[40..48].copy_from_slice(&[255, 0, 0, 0, 0, 0, 255, 0]);
    let rgba = codec::decode_dib(&dib).unwrap();
    assert_eq!(rgba.get_pixel(0, 0).0, [255, 0, 0, 255]);
    assert_eq!(rgba.get_pixel(0, 1).0, [0, 0, 255, 255]);
    dib[14..16].copy_from_slice(&32u16.to_le_bytes());
    let rgba = codec::decode_dib(&dib).unwrap();
    assert_eq!(rgba.get_pixel(0, 0).0, [255, 0, 0, 255]);
    assert!(codec::decode_dib(&dib[..47]).is_err());
    dib[16..20].copy_from_slice(&1u32.to_le_bytes());
    assert!(codec::decode_dib(&dib).is_err());
}
