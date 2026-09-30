$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$logo = [Drawing.Image]::FromFile((Join-Path $root 'public\preshot-mark.png'))
try {
    foreach ($kind in @('banner', 'dialog')) {
        $height = if ($kind -eq 'banner') { 58 } else { 312 }
        $bitmap = [Drawing.Bitmap]::new(493, $height, [Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([Drawing.Color]::White)
            $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            if ($kind -eq 'banner') {
                $graphics.DrawImage($logo, 437, 5, 48, 48)
            } else {
                $brush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(242, 243, 245))
                $graphics.FillRectangle($brush, 0, 0, 164, 312)
                $brush.Dispose()
                $graphics.DrawImage($logo, 22, 65, 120, 120)
                $font = [Drawing.Font]::new('Segoe UI', 18, [Drawing.FontStyle]::Bold)
                $graphics.DrawString('Preshot', $font, [Drawing.Brushes]::Black, 30, 195)
                $font.Dispose()
            }
            $bitmap.Save((Join-Path $root "src-tauri\wix\$kind.bmp"), [Drawing.Imaging.ImageFormat]::Bmp)
        } finally { $graphics.Dispose(); $bitmap.Dispose() }
    }
} finally { $logo.Dispose() }
