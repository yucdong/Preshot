# Batch fix test files for v3 migration
$files = @(
  "src\domain\plan\canvas\dropTarget.test.ts",
  "src\domain\plan\canvas\engine.test.ts",
  "src\domain\plan\canvas\pdf\exportDocument.test.ts",
  "src\domain\plan\canvas\plan.test.ts",
  "src\domain\plan\canvas\service.test.ts",
  "src\features\plan\ProjectCanvasProvider.test.tsx",
  "src\features\plan\canvas\imageDropTarget.test.ts",
  "src\features\plan\canvas\PlanCanvas.test.tsx",
  "src\features\plan\canvas\ReferenceComponentView.test.tsx",
  "src\features\plan\canvas\useComponentResize.test.ts"
)

foreach ($file in $files) {
  if (Test-Path $file) {
    $content = Get-Content $file -Raw
    # Replace widthFraction: "..." with width: numeric
    $content = $content -replace 'widthFraction:\s*"1"', 'width: 1'
    $content = $content -replace 'widthFraction:\s*"3/4"', 'width: 0.75'
    $content = $content -replace 'widthFraction:\s*"2/3"', 'width: 0.667'
    $content = $content -replace 'widthFraction:\s*"1/2"', 'width: 0.5'
    $content = $content -replace 'widthFraction:\s*"1/3"', 'width: 0.333'
    $content = $content -replace 'widthFraction:\s*"1/4"', 'width: 0.25'
    # Remove columnsPerRow lines
    $content = $content -replace ',?\s*columnsPerRow:\s*\d+', ''
    # Add aspectRatio: 1 to images (covers multiple patterns)
    $content = $content -replace '(\{\s*id:\s*"[^"]+",\s*file:\s*"[^"]+")\s*\}', '$1, aspectRatio: 1 }'
    $content = $content -replace '(\{\s*id:\s*"[^"]+",\s*file:\s*"[^"]+",\s*caption:\s*"[^"]+")\s*\}', '$1, aspectRatio: 1 }'
    # Change schemaVersion: 2 to schemaVersion: 3
    $content = $content -replace 'schemaVersion:\s*2', 'schemaVersion: 3'
    # Add imageHeight: 180 for reference components (after showCaptions line)
    $content = $content -replace '(showCaptions:\s*(?:true|false)),\s*images:', '$1, imageHeight: 180, images:'
    Set-Content $file $content -NoNewline
    Write-Host "Fixed $file"
  }
}
Write-Host "Done!"
