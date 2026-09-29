# Preshot artwork

`preshot-logo-original.png` is the supplied 682 × 1024 street-photographer image.
Keep it intact as the source. The application master is
[`public/preshot-mark.png`](../../public/preshot-mark.png), an RGBA 1024 × 1024 PNG.

The master retains the photographer, light, shadow and complete rounded tile.
Only the exterior portrait backdrop is removed. Preparation uses a rounded
mask at source bounds `(8, 129, 677, 858)`, radius 140px, antialiased at 4×;
the crop is centered on a transparent square with 12px vertical padding before
proportional Lanczos resizing. Do not stretch the portrait source to a square.

The app's shared `BrandMark`, browser favicon and both READMEs reference the
master. Run `pnpm icons:generate` after updating it to regenerate desktop PNGs,
the multi-resolution Windows ICO and ICNS under `src-tauri/icons`.
Rebuild the application/MSI to embed changed native icons.
