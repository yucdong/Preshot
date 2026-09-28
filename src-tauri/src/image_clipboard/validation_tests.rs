use super::*;

fn fixtures() -> Vec<(&'static str, Vec<u8>)> {
    let rgba = image::RgbaImage::from_pixel(2, 1, image::Rgba([255, 0, 0, 255]));
    let png = codec::encode_png(&rgba).unwrap();
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new(&mut jpeg)
        .encode(
            &[255, 0, 0, 255, 0, 0],
            2,
            1,
            image::ExtendedColorType::Rgb8,
        )
        .unwrap();
    let mut gif = Vec::new();
    {
        let mut encoder = image::codecs::gif::GifEncoder::new(&mut gif);
        encoder
            .encode_frame(image::Frame::new(rgba.clone()))
            .unwrap();
        encoder
            .encode_frame(image::Frame::new(rgba.clone()))
            .unwrap();
    }
    let mut webp = Vec::new();
    image::codecs::webp::WebPEncoder::new_lossless(&mut webp)
        .encode(rgba.as_raw(), 2, 1, image::ExtendedColorType::Rgba8)
        .unwrap();
    vec![
        ("image/png", png),
        ("image/jpeg", jpeg),
        ("image/gif", gif),
        ("image/webp", webp),
    ]
}

#[test]
fn shared_validator_uses_bounded_child_for_all_four_formats_without_changing_bytes() {
    for (mime, bytes) in fixtures() {
        let original = bytes.clone();
        assert_eq!(
            validate_encoded_image_dimensions(&bytes, mime).unwrap(),
            (2, 1)
        );
        assert_eq!(bytes, original);
    }
}

#[test]
fn shared_validator_rejects_empty_oversized_mismatched_and_unsupported_payloads() {
    let (_, png) = fixtures().remove(0);
    assert!(validate_encoded_image_dimensions(&[], "image/png").is_err());
    assert!(validate_encoded_image_dimensions(&vec![0; MAX_ENCODED + 1], "image/png").is_err());
    for mime in [
        "image/jpeg",
        "image/svg+xml",
        "image/tiff",
        "image/PNG",
        "file:///C:/image.png",
    ] {
        assert!(validate_encoded_image_dimensions(&png, mime).is_err());
    }
    for (mime, bytes) in fixtures() {
        assert!(validate_encoded_image_dimensions(&bytes[..bytes.len().min(12)], mime).is_err());
    }
}

#[test]
fn shared_validator_returns_oriented_dimensions_and_preserves_encoded_jpeg() {
    let (_, jpeg) = fixtures().remove(1);
    let exif = b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0";
    let mut oriented = jpeg[..2].to_vec();
    oriented.extend_from_slice(&[0xff, 0xe1]);
    oriented.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
    oriented.extend_from_slice(exif);
    oriented.extend_from_slice(&jpeg[2..]);
    let original = oriented.clone();
    assert_eq!(
        validate_encoded_image_dimensions(&oriented, "image/jpeg").unwrap(),
        (1, 2)
    );
    assert_eq!(oriented, original);
}

fn replace_png_dimensions(png: &mut [u8], width: u32, height: u32) {
    png[16..20].copy_from_slice(&width.to_be_bytes());
    png[20..24].copy_from_slice(&height.to_be_bytes());
    let mut crc = !0u32;
    for &byte in &png[12..29] {
        crc ^= byte as u32;
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb88320 & (0u32.wrapping_sub(crc & 1)));
        }
    }
    png[29..33].copy_from_slice(&(!crc).to_be_bytes());
}

#[test]
fn shared_validator_rejects_dimension_pixel_and_complete_operation_budgets_before_decode() {
    for (width, height) in [(0, 1), (8193, 1), (8192, 4096), (8192, 1024)] {
        let (_, mut png) = fixtures().remove(0);
        replace_png_dimensions(&mut png, width, height);
        let failure = validate_encoded_image_dimensions(&png, "image/png").unwrap_err();
        if width > 0 {
            assert_eq!(failure.code, "image_clipboard_oversized");
        }
    }
}
