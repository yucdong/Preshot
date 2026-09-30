//! Screenshot-only review hints. Never reject a valid dark photo or alter its pixels.
use crate::error::CommandError;
use base64::{engine::general_purpose::STANDARD, Engine};

#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum ReviewReason {
    UniformDark,
    Transparent,
}

#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureReview {
    reason: ReviewReason,
    preview_url: String,
}

pub(super) fn review_pixels(
    width: u32,
    height: u32,
    rgba: &[u8],
) -> Result<Option<CaptureReview>, CommandError> {
    let invalid = || {
        CommandError::new(
            "screen_capture_invalid_image",
            "The captured image has invalid RGBA data",
        )
    };
    let length = (width as usize)
        .checked_mul(height as usize)
        .and_then(|n| n.checked_mul(4));
    if width == 0 || height == 0 || length != Some(rgba.len()) {
        return Err(invalid());
    }
    let mut transparent = true;
    let mut opaque = true;
    let mut minimum = 255u8;
    let mut maximum = 0u8;
    for pixel in rgba.chunks_exact(4) {
        transparent &= pixel[3] == 0;
        opaque &= pixel[3] == 255;
        for channel in &pixel[..3] {
            minimum = minimum.min(*channel);
            maximum = maximum.max(*channel);
        }
    }
    let reason = if transparent {
        ReviewReason::Transparent
    } else if opaque && maximum <= 24 && maximum - minimum <= 4 {
        ReviewReason::UniformDark
    } else {
        return Ok(None);
    };
    // A bounded preview directly sampled from the already-owned RGBA buffer.
    // No second full-resolution decode or image-sized allocation is necessary.
    let scale = (320.0 / width as f64).min(200.0 / height as f64).min(1.0);
    let w = (width as f64 * scale).round().max(1.0) as u32;
    let h = (height as f64 * scale).round().max(1.0) as u32;
    let mut preview = Vec::with_capacity((w * h * 4) as usize);
    for y in 0..h {
        for x in 0..w {
            let offset = (((y as u64 * height as u64 / h as u64) * width as u64
                + x as u64 * width as u64 / w as u64)
                * 4) as usize;
            preview.extend_from_slice(&rgba[offset..offset + 4]);
        }
    }
    let mut encoded = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut encoded, w, h);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|_| invalid())?;
        writer.write_image_data(&preview).map_err(|_| invalid())?;
    }
    Ok(Some(CaptureReview {
        reason,
        preview_url: format!("data:image/png;base64,{}", STANDARD.encode(encoded)),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn black_and_transparent_captures_need_review_without_rewriting_pixels() {
        let pixels = [11, 11, 14, 255].repeat(6);
        let before = pixels.clone();
        let review = review_pixels(3, 2, &pixels).unwrap().unwrap();
        assert_eq!(review.reason, ReviewReason::UniformDark);
        assert!(review.preview_url.starts_with("data:image/png;base64,"));
        assert_eq!(pixels, before);
        assert_eq!(
            review_pixels(1, 1, &[12, 34, 56, 0])
                .unwrap()
                .unwrap()
                .reason,
            ReviewReason::Transparent
        );
    }
    #[test]
    fn detailed_dark_and_normal_images_are_not_flagged_and_invalid_buffers_fail() {
        assert!(review_pixels(2, 1, &[0, 0, 0, 255, 20, 20, 20, 255])
            .unwrap()
            .is_none());
        assert!(review_pixels(1, 1, &[255, 0, 0, 255]).unwrap().is_none());
        assert!(review_pixels(1, 1, &[0, 0, 0, 128]).unwrap().is_none());
        assert!(review_pixels(0, 0, &[]).is_err());
        assert!(review_pixels(2, 2, &[0; 4]).is_err());
    }
    #[test]
    fn warning_preview_is_bounded_for_wide_capture() {
        let result = review_pixels(3000, 500, &[0, 0, 0, 255].repeat(3000 * 500))
            .unwrap()
            .unwrap();
        let png = STANDARD
            .decode(result.preview_url.split(',').nth(1).unwrap())
            .unwrap();
        let decoder = png::Decoder::new(std::io::Cursor::new(png));
        let reader = decoder.read_info().unwrap();
        assert!(reader.info().width <= 320 && reader.info().height <= 200);
    }
}
