use super::*;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Rgba, RgbaImage};
use std::io::{Cursor, Write};

pub(super) struct Prepared {
    pub original: Vec<u8>,
    pub mime: &'static str,
    pub metadata: Metadata,
    pub png: Vec<u8>,
    pub dib: Vec<u8>,
    pub animated: bool,
}

pub(super) fn check_dimensions(width: u32, height: u32) -> Result<usize, CommandError> {
    let pixels = u64::from(width) * u64::from(height);
    if width == 0 || height == 0 || width > 8192 || height > 8192 || pixels > 32_000_000 {
        Err(oversized())
    } else {
        Ok(pixels as usize)
    }
}

pub(super) fn check_budget(
    source_pixels: usize,
    output_pixels: usize,
    encoded: usize,
    input: usize,
    retained: usize,
) -> Result<(), CommandError> {
    // Peak includes decoder working planes/orientation, compositing, PNG scratch/output,
    // input/base64, the previous rich snapshot, and both process/OS publication buffers.
    let peak = source_pixels
        .checked_mul(20)
        .and_then(|n| n.checked_add(output_pixels.checked_mul(8)?))
        .and_then(|n| n.checked_add(encoded + input + retained + 48 * MIB))
        .ok_or_else(oversized)?;
    if peak > 256 * MIB {
        Err(oversized())
    } else {
        Ok(())
    }
}

fn parse_data_url(value: &str) -> Result<(&'static str, ImageFormat, Vec<u8>), CommandError> {
    let (prefix, body) = value.split_once(',').ok_or_else(invalid)?;
    let (mime, format) = match prefix {
        "data:image/png;base64" => ("image/png", ImageFormat::Png),
        "data:image/jpeg;base64" => ("image/jpeg", ImageFormat::Jpeg),
        "data:image/gif;base64" => ("image/gif", ImageFormat::Gif),
        "data:image/webp;base64" => ("image/webp", ImageFormat::WebP),
        _ => {
            return Err(error(
                "unsupported",
                "仅支持 JPEG、PNG、GIF 和 WebP 图片，请重新选择图片。",
            ))
        }
    };
    if body.is_empty() || body.len() > MAX_ENCODED.div_ceil(3) * 4 {
        return Err(oversized());
    }
    let bytes = STANDARD.decode(body).map_err(|_| invalid())?;
    if bytes.len() > MAX_ENCODED {
        return Err(oversized());
    }
    if image::guess_format(&bytes).map_err(|_| invalid())? != format {
        return Err(invalid());
    }
    Ok((mime, format, bytes))
}

fn limits() -> image::Limits {
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(64 * MIB as u64);
    limits
}

fn preflight(
    bytes: &[u8],
    format: ImageFormat,
    input: usize,
    retained: usize,
) -> Result<usize, CommandError> {
    if bytes.len() > MAX_ENCODED || bytes.len() + input + retained + 64 * MIB > 256 * MIB {
        return Err(oversized());
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(limits());
    let decoder = reader.into_decoder().map_err(|cause| match cause {
        image::ImageError::Limits(_) => oversized(),
        _ => invalid(),
    })?;
    let (width, height) = decoder.dimensions();
    let pixels = check_dimensions(width, height)?;
    check_budget(pixels, pixels, bytes.len(), input, retained)?;
    Ok(pixels)
}

pub(super) fn validated_dimensions(
    bytes: &[u8],
    mime_type: &str,
) -> Result<(u32, u32), CommandError> {
    if bytes.is_empty() {
        return Err(invalid());
    }
    if bytes.len() > MAX_ENCODED {
        return Err(oversized());
    }
    let format = match mime_type {
        "image/png" => ImageFormat::Png,
        "image/jpeg" => ImageFormat::Jpeg,
        "image/gif" => ImageFormat::Gif,
        "image/webp" => ImageFormat::WebP,
        _ => return Err(error("unsupported", "仅支持 JPEG、PNG、GIF 和 WebP 图片。")),
    };
    if image::guess_format(bytes).map_err(|_| invalid())? != format {
        return Err(invalid());
    }
    let pixels = preflight(bytes, format, 0, 0)?;
    #[cfg(windows)]
    {
        // This boundary uses the hard-limited child even under cfg(test), so storage
        // regressions exercise the production allocation boundary rather than a soft limit.
        let (rgba, _) = super::process::decode_isolated(bytes, format, pixels, 0, 0)?;
        Ok(rgba.dimensions())
    }
    #[cfg(not(windows))]
    {
        let _ = pixels;
        Err(error(
            "unavailable",
            "当前系统不支持有界图片解码，请在 Windows 桌面应用中重试。",
        ))
    }
}

fn decode(
    bytes: &[u8],
    format: ImageFormat,
    input: usize,
    retained: usize,
) -> Result<(RgbaImage, bool), CommandError> {
    let pixels = preflight(bytes, format, input, retained)?;
    #[cfg(all(windows, not(test)))]
    {
        super::process::decode_isolated(bytes, format, pixels, input, retained)
    }
    #[cfg(any(not(windows), test))]
    {
        let _ = pixels;
        decode_local(bytes, format)
    }
}

pub(super) fn decode_local(
    bytes: &[u8],
    format: ImageFormat,
) -> Result<(RgbaImage, bool), CommandError> {
    if bytes.len() > MAX_ENCODED {
        return Err(oversized());
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.limits(limits());
    let mut decoder = reader.into_decoder().map_err(|_| invalid())?;
    let (width, height) = decoder.dimensions();
    check_dimensions(width, height)?;
    let animated = match format {
        ImageFormat::Gif => gif_animated(bytes)?,
        ImageFormat::WebP => image::codecs::webp::WebPDecoder::new(Cursor::new(bytes))
            .map_err(|_| invalid())?
            .has_animation(),
        ImageFormat::Png => {
            image::codecs::png::PngDecoder::with_limits(Cursor::new(bytes), limits())
                .map_err(|_| invalid())?
                .is_apng()
                .map_err(|_| invalid())?
        }
        _ => false,
    };
    let orientation = decoder.orientation().map_err(|_| invalid())?;
    // ImageDecoder reads only the first frame for GIF/WebP; never collect animation frames.
    let mut decoded = DynamicImage::from_decoder(decoder).map_err(|_| {
        error(
            "decode",
            "图片无法安全解码，请使用有效的 JPEG、PNG、GIF 或 WebP 图片。",
        )
    })?;
    decoded.apply_orientation(orientation);
    Ok((decoded.into_rgba8(), animated))
}

fn gif_animated(bytes: &[u8]) -> Result<bool, CommandError> {
    if bytes.len() < 13 {
        return Err(invalid());
    }
    let mut at = 13;
    if bytes[10] & 0x80 != 0 {
        at += 3 * (1usize << ((bytes[10] & 7) + 1));
    }
    let mut count = 0;
    fn skip_blocks(bytes: &[u8], at: &mut usize) -> Result<(), CommandError> {
        loop {
            let size = *bytes.get(*at).ok_or_else(invalid)? as usize;
            *at += 1;
            if size == 0 {
                return Ok(());
            }
            *at = at
                .checked_add(size)
                .filter(|&n| n <= bytes.len())
                .ok_or_else(invalid)?;
        }
    }
    loop {
        match bytes.get(at).copied().ok_or_else(invalid)? {
            0x3b => {
                return if count > 0 {
                    Ok(count > 1)
                } else {
                    Err(invalid())
                }
            }
            0x21 => {
                at += 2;
                skip_blocks(bytes, &mut at)?;
            }
            0x2c => {
                let descriptor = bytes.get(at + 1..at + 10).ok_or_else(invalid)?;
                check_dimensions(
                    u16::from_le_bytes(descriptor[4..6].try_into().unwrap()) as u32,
                    u16::from_le_bytes(descriptor[6..8].try_into().unwrap()) as u32,
                )?;
                at += 10;
                if descriptor[8] & 0x80 != 0 {
                    at += 3 * (1usize << ((descriptor[8] & 7) + 1));
                }
                at += 1;
                skip_blocks(bytes, &mut at)?;
                count += 1;
            }
            _ => return Err(invalid()),
        }
    }
}

fn rounded(value: f64) -> f64 {
    (value * 1_000_000.0).round() / 1_000_000.0
}

fn view_crop(p: &Presentation) -> Crop {
    // Port of domain/plan/canvas/imageView.ts: normalizeImageCrop + centeredCoverCrop.
    let crop = if p.fit_mode == Some(FitMode::Stretch) {
        Crop {
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        }
    } else if let Some(crop) = &p.crop {
        crop.clone()
    } else {
        let frame_ratio = p.frame_width / p.frame_height;
        let (width, height) = if frame_ratio >= p.aspect_ratio {
            (1.0, p.aspect_ratio / frame_ratio)
        } else {
            (frame_ratio / p.aspect_ratio, 1.0)
        };
        Crop {
            x: (1.0 - width) / 2.0,
            y: (1.0 - height) / 2.0,
            width,
            height,
        }
    };
    let width = crop.width.clamp(0.000001, 1.0);
    let height = crop.height.clamp(0.000001, 1.0);
    Crop {
        x: rounded(crop.x.clamp(0.0, 1.0 - width)),
        y: rounded(crop.y.clamp(0.0, 1.0 - height)),
        width: rounded(width),
        height: rounded(height),
    }
}

pub(super) fn render_encoded(bytes: &[u8], p: &Presentation, maximum_bytes: usize) -> Result<Vec<u8>, CommandError> {
    if bytes.is_empty() || bytes.len() > maximum_bytes || maximum_bytes > 64 * MIB {
        return Err(invalid());
    }
    let crop = view_crop(p);
    // Preserve original JPEG/PNG bytes when the native block can display them directly.
    if crop.x == 0.0 && crop.y == 0.0 && crop.width == 1.0 && crop.height == 1.0
        && (p.frame_width / p.frame_height - p.aspect_ratio).abs() < 0.000001
    {
        return Ok(bytes.to_vec());
    }
    let format = image::guess_format(bytes).map_err(|_| invalid())?;
    if !matches!(format, ImageFormat::Jpeg | ImageFormat::Png) { return Err(invalid()); }
    // Owned material files have their own encoded-byte budget. Clipboard IPC
    // continues to use the isolated decoder and its smaller MAX_ENCODED cap.
    // Material originals have no fixed resolution cap. Keep clipboard-specific
    // dimensions and allocation budgets in the separate clipboard decode path.
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    reader.no_limits();
    let mut decoder = reader.into_decoder().map_err(|_| invalid())?;
    let orientation = decoder.orientation().map_err(|_| invalid())?;
    let mut decoded = DynamicImage::from_decoder(decoder).map_err(|_| invalid())?;
    decoded.apply_orientation(orientation);
    let source = decoded.into_rgba8();
    encode_png_with_limit(&render_pixels(source, Some(p), false)?, maximum_bytes)
}

pub(super) fn render(
    source: RgbaImage,
    presentation: Option<&Presentation>,
) -> Result<RgbaImage, CommandError> {
    render_pixels(source, presentation, true)
}

fn render_pixels(
    source: RgbaImage,
    presentation: Option<&Presentation>,
    clipboard_limits: bool,
) -> Result<RgbaImage, CommandError> {
    let Some(p) = presentation else {
        return Ok(source);
    };
    let crop = view_crop(p);
    let sx = rounded(crop.x * source.width() as f64);
    let sy = rounded(crop.y * source.height() as f64);
    let sw = rounded(crop.width * source.width() as f64);
    let sh = rounded(crop.height * source.height() as f64);
    // Source-derived scale respects both axes, including explicit stretch; it never upscales.
    let scale = (sw / p.frame_width).min(sh / p.frame_height);
    let width = (p.frame_width * scale + 1e-9).floor() as u32;
    let height = (p.frame_height * scale + 1e-9).floor() as u32;
    if clipboard_limits { check_dimensions(width, height)?; }
    if width == 0 || height == 0 { return Err(invalid()); }
    let length = (width as usize).checked_mul(height as usize)
        .and_then(|pixels| pixels.checked_mul(4)).ok_or_else(invalid)?;
    let mut pixels = Vec::new();
    pixels.try_reserve_exact(length).map_err(|_| invalid())?;
    pixels.resize(length, 0);
    let mut result = RgbaImage::from_raw(width, height, pixels).ok_or_else(invalid)?;
    // Bilinear sampling in premultiplied alpha avoids dark transparent-edge halos.
    for (x, y, target) in result.enumerate_pixels_mut() {
        let px = (sx + (x as f64 + 0.5) * sw / width as f64 - 0.5)
            .clamp(0.0, source.width() as f64 - 1.0);
        let py = (sy + (y as f64 + 0.5) * sh / height as f64 - 0.5)
            .clamp(0.0, source.height() as f64 - 1.0);
        let x0 = px.floor() as u32;
        let y0 = py.floor() as u32;
        let fx = px - x0 as f64;
        let fy = py - y0 as f64;
        let mut sums = [0.0; 4];
        for (ix, iy, weight) in [
            (x0, y0, (1.0 - fx) * (1.0 - fy)),
            ((x0 + 1).min(source.width() - 1), y0, fx * (1.0 - fy)),
            (x0, (y0 + 1).min(source.height() - 1), (1.0 - fx) * fy),
            (
                (x0 + 1).min(source.width() - 1),
                (y0 + 1).min(source.height() - 1),
                fx * fy,
            ),
        ] {
            let sample = source.get_pixel(ix, iy).0;
            let alpha = sample[3] as f64 / 255.0;
            for channel in 0..3 {
                sums[channel] += sample[channel] as f64 * alpha * weight;
            }
            sums[3] += sample[3] as f64 * weight;
        }
        *target = Rgba([
            if sums[3] > 0.0 {
                (sums[0] * 255.0 / sums[3]).round() as u8
            } else {
                0
            },
            if sums[3] > 0.0 {
                (sums[1] * 255.0 / sums[3]).round() as u8
            } else {
                0
            },
            if sums[3] > 0.0 {
                (sums[2] * 255.0 / sums[3]).round() as u8
            } else {
                0
            },
            sums[3].round() as u8,
        ]);
    }
    Ok(result)
}

struct BoundedPng(Vec<u8>, usize);
impl Write for BoundedPng {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.0.len().saturating_add(bytes.len()) > self.1 {
            return Err(std::io::Error::other("PNG exceeds its encoded-byte limit"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

pub(super) fn encode_png(image: &RgbaImage) -> Result<Vec<u8>, CommandError> {
    encode_png_with_limit(image, MAX_ENCODED)
}

fn encode_png_with_limit(image: &RgbaImage, maximum_bytes: usize) -> Result<Vec<u8>, CommandError> {
    let mut output = BoundedPng(Vec::new(), maximum_bytes);
    {
        let mut encoder = png::Encoder::new(&mut output, image.width(), image.height());
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_source_srgb(png::SrgbRenderingIntent::Perceptual);
        let mut writer = encoder.write_header().map_err(|_| oversized())?;
        writer
            .write_image_data(image.as_raw())
            .map_err(|_| oversized())?;
        writer.finish().map_err(|_| oversized())?;
    }
    Ok(output.0)
}

pub(super) fn prepare(
    input: ImageClipboardInput,
    retained: usize,
) -> Result<Prepared, CommandError> {
    input.validate()?;
    let (mime, format, original) = parse_data_url(&input.data_url)?;
    let (source, animated) = decode(&original, format, input.data_url.len(), retained)?;
    let ImageClipboardInput {
        data_url,
        name,
        presentation,
        native_props,
    } = input;
    drop(data_url);
    let rendered = render(source, presentation.as_ref())?;
    let png = encode_png(&rendered)?;
    let dib = encode_dib(rendered);
    Ok(Prepared {
        original,
        mime,
        metadata: Metadata {
            name,
            presentation,
            native_props,
        },
        png,
        dib,
        animated,
    })
}

pub(super) fn external(
    raster: Raster,
    retained: usize,
) -> Result<ImageClipboardContents, CommandError> {
    let (rgba, animated) = match raster {
        Raster::Png(bytes) => decode(&bytes, ImageFormat::Png, 0, retained)?,
        Raster::Dib(bytes) => {
            let layout = dib_layout(&bytes, bytes.len())?;
            check_budget(layout.pixels(), layout.pixels(), bytes.len(), 0, retained)?;
            (decode_dib(&bytes)?, false)
        }
    };
    let png = encode_png(&rgba)?;
    let url = format!("data:image/png;base64,{}", STANDARD.encode(png));
    Ok(ImageClipboardContents {
        original: ImageClipboardInput {
            data_url: url.clone(),
            name: "剪贴板图片.png".into(),
            presentation: None,
            native_props: None,
        },
        rendered_data_url: url,
        animated,
        external: true,
        lease: None,
    })
}

pub(super) fn encode_dib(image: RgbaImage) -> Vec<u8> {
    let width = image.width();
    let height = image.height();
    let mut bytes = image.into_raw();
    for pixel in bytes.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }
    let length = bytes.len();
    bytes.resize(length + 124, 0);
    bytes.copy_within(0..length, 124);
    bytes[..124].fill(0);
    for (offset, value) in [
        (0, 124),
        (4, width),
        (8, (-(height as i32)) as u32),
        (16, 3),
        (20, length as u32),
        (40, 0x00ff0000),
        (44, 0x0000ff00),
        (48, 0x000000ff),
        (52, 0xff000000),
        (56, 0x73524742),
        (108, 4),
    ] {
        bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }
    bytes[12..14].copy_from_slice(&1u16.to_le_bytes());
    bytes[14..16].copy_from_slice(&32u16.to_le_bytes());
    bytes
}

fn u32_at(bytes: &[u8], at: usize) -> Result<u32, CommandError> {
    Ok(u32::from_le_bytes(
        bytes
            .get(at..at + 4)
            .ok_or_else(invalid)?
            .try_into()
            .unwrap(),
    ))
}

pub(super) struct DibLayout {
    width: u32,
    height: u32,
    top_down: bool,
    bits: usize,
    stride: usize,
    offset: usize,
    masks: [u32; 4],
    palette: usize,
    palette_count: usize,
    pub length: usize,
}
impl DibLayout {
    pub fn pixels(&self) -> usize {
        self.width as usize * self.height as usize
    }
}

pub(super) fn dib_layout(bytes: &[u8], total: usize) -> Result<DibLayout, CommandError> {
    let header = u32_at(bytes, 0)? as usize;
    if ![40, 52, 56, 108, 124].contains(&header) || total < header || bytes.len() < header {
        return Err(invalid());
    }
    let width = u32_at(bytes, 4)? as i32;
    let signed_height = u32_at(bytes, 8)? as i32;
    if width <= 0 || signed_height == i32::MIN || bytes[12..14] != 1u16.to_le_bytes() {
        return Err(invalid());
    }
    let height = signed_height.unsigned_abs();
    let pixels = check_dimensions(width as u32, height)?;
    let bits = u16::from_le_bytes(bytes[14..16].try_into().unwrap()) as usize;
    let compression = u32_at(bytes, 16)?;
    if ![1, 4, 8, 16, 24, 32].contains(&bits)
        || ![0, 3, 6].contains(&compression)
        || (compression != 0 && bits != 16 && bits != 32)
    {
        return Err(error(
            "unsupported",
            "此剪贴板位图格式暂不支持，请在图片应用中转为 PNG 后重试。",
        ));
    }
    if header >= 108 && ![0, 0x73524742, 0x57696e20].contains(&u32_at(bytes, 56)?) {
        return Err(error(
            "unsupported",
            "此位图使用不支持的颜色配置，请转换为 sRGB PNG 后重试。",
        ));
    }
    if header == 124 && (u32_at(bytes, 112)? != 0 || u32_at(bytes, 116)? != 0) {
        return Err(invalid());
    }
    let external_masks = if header == 40 && compression != 0 {
        if compression == 6 {
            16
        } else {
            12
        }
    } else {
        0
    };
    let palette = header + external_masks;
    let used = u32_at(bytes, 32)? as usize;
    let palette_count = if bits <= 8 {
        if used == 0 {
            1 << bits
        } else {
            used
        }
    } else {
        used
    };
    if palette_count > 256 || (bits <= 8 && palette_count > 1 << bits) {
        return Err(invalid());
    }
    let offset = palette + palette_count * 4;
    let stride = (width as usize * bits).div_ceil(32) * 4;
    let length = offset + stride * height as usize;
    if length > total {
        return Err(invalid());
    }
    check_budget(pixels, pixels, length, 0, 0)?;
    let masks = if compression != 0 {
        let alpha = if header >= 56 || compression == 6 {
            u32_at(bytes, 52)?
        } else {
            0
        };
        [
            u32_at(bytes, 40)?,
            u32_at(bytes, 44)?,
            u32_at(bytes, 48)?,
            alpha,
        ]
    } else if bits == 16 {
        [0x7c00, 0x03e0, 0x001f, 0]
    } else {
        [0x00ff0000, 0x0000ff00, 0x000000ff, 0]
    };
    for (i, mask) in masks.iter().copied().enumerate() {
        if i < 3 && mask == 0 {
            return Err(invalid());
        }
        if mask != 0 {
            let shifted = mask >> mask.trailing_zeros();
            if shifted & shifted.wrapping_add(1) != 0
                || (bits == 16 && mask > 0xffff)
                || masks[..i].iter().any(|previous| mask & previous != 0)
            {
                return Err(invalid());
            }
        }
    }
    Ok(DibLayout {
        width: width as u32,
        height,
        top_down: signed_height < 0,
        bits,
        stride,
        offset,
        masks,
        palette,
        palette_count,
        length,
    })
}

pub(super) fn decode_dib(bytes: &[u8]) -> Result<RgbaImage, CommandError> {
    let layout = dib_layout(bytes, bytes.len())?;
    let mut image = RgbaImage::new(layout.width, layout.height);
    fn component(value: u32, mask: u32, fallback: u8) -> u8 {
        if mask == 0 {
            return fallback;
        }
        let shift = mask.trailing_zeros();
        let maximum = mask >> shift;
        (((value & mask) >> shift) as u64 * 255 / maximum as u64) as u8
    }
    for (x, y, pixel) in image.enumerate_pixels_mut() {
        let row_y = if layout.top_down {
            y
        } else {
            layout.height - 1 - y
        };
        let row = layout.offset + row_y as usize * layout.stride;
        let at = row + x as usize * layout.bits / 8;
        *pixel = if layout.bits <= 8 {
            let index = match layout.bits {
                1 => (bytes[at] >> (7 - x % 8)) & 1,
                4 => (bytes[at] >> (if x % 2 == 0 { 4 } else { 0 })) & 15,
                _ => bytes[at],
            } as usize;
            if index >= layout.palette_count {
                return Err(invalid());
            }
            let at = layout.palette + index * 4;
            Rgba([bytes[at + 2], bytes[at + 1], bytes[at], 255])
        } else if layout.bits == 24 {
            Rgba([bytes[at + 2], bytes[at + 1], bytes[at], 255])
        } else {
            let value = if layout.bits == 16 {
                u16::from_le_bytes(bytes[at..at + 2].try_into().unwrap()) as u32
            } else {
                u32_at(bytes, at)?
            };
            Rgba([
                component(value, layout.masks[0], 0),
                component(value, layout.masks[1], 0),
                component(value, layout.masks[2], 0),
                component(value, layout.masks[3], 255),
            ])
        };
    }
    Ok(image)
}
