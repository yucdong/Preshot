param([int]$AppId,[string]$Output)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'demo-native-tools.ps1')
$handle = (Get-Process -Id $AppId).MainWindowHandle
$start = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$frames = [System.Collections.Generic.List[object]]::new()
while (-not (Test-Path -LiteralPath (Join-Path $Output 'stop'))) {
    $captureHandle=$handle
    $handleFile=Join-Path $Output 'capture-handle.txt'
    if(Test-Path -LiteralPath $handleFile) {
        $requested=0L
        if([long]::TryParse((Get-Content -LiteralPath $handleFile -Raw).Trim(),[ref]$requested) -and $requested -ne 0) {$captureHandle=[IntPtr]$requested}
    }
    $seconds=([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-$start)/1000
    $file=('{0:d6}.jpg' -f $frames.Count)
    Save-DemoFrame $captureHandle (Join-Path $Output $file)
    $frames.Add(@{ file=$file; seconds=$seconds })
    Start-Sleep -Milliseconds 150
}
$data=@{started=$start;frames=@($frames.ToArray());duration=([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-$start)/1000}
[System.IO.File]::WriteAllText((Join-Path $Output 'frames.json'),($data | ConvertTo-Json -Depth 5),[System.Text.UTF8Encoding]::new($false))
