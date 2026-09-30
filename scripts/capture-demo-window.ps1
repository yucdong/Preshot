param([int]$AppId,[string]$Output)
$ErrorActionPreference='Stop'
$start = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$frames = [System.Collections.Generic.List[object]]::new()
$captureError=$null
$captureHandle=[IntPtr]::Zero
$surface='application'
$stage='initialize'
$file=$null
try {
    . (Join-Path $PSScriptRoot 'demo-native-tools.ps1')
    $handle = (Get-Process -Id $AppId).MainWindowHandle
    while (-not (Test-Path -LiteralPath (Join-Path $Output 'stop'))) {
        $captureHandle=$handle
        $surface='application'
        $file=('{0:d6}.jpg' -f $frames.Count)
        $stage='read-marker'
        $handleFile=Join-Path $Output 'capture-handle.txt'
        if(Test-Path -LiteralPath $handleFile) {
            $requestedText=$null
            try { $requestedText=Get-Content -LiteralPath $handleFile -Raw -ErrorAction Stop }
            catch [System.Management.Automation.ItemNotFoundException] { $requestedText=$null }
            catch [System.IO.FileNotFoundException] { $requestedText=$null }
            # The recorder owner may remove or briefly empty this marker while
            # returning to the app. Other read/capture failures must still fail.
            $requested=0L
            if(-not [string]::IsNullOrWhiteSpace($requestedText) -and
                    [long]::TryParse($requestedText.Trim(),[ref]$requested) -and $requested -ne 0) {
                $captureHandle=[IntPtr]$requested
            }
        }
        $surface=if($captureHandle -eq $handle){'application'}else{'external-window'}
        $seconds=([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-$start)/1000
        $stage='capture'
        Save-DemoFrame $captureHandle (Join-Path $Output $file)
        $frames.Add(@{ file=$file; seconds=$seconds; surface=$surface })
        Start-Sleep -Milliseconds 150
    }
} catch { $captureError=$_ }
finally {
    $captureMessages=@()
    if($captureError){$captureMessages=@($captureError.Exception.Message)}
    $data=@{started=$start;frames=@($frames.ToArray());duration=([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-$start)/1000;completed=($null -eq $captureError);errors=$captureMessages}
    [System.IO.File]::WriteAllText((Join-Path $Output 'frames.json'),($data | ConvertTo-Json -Depth 5),[System.Text.UTF8Encoding]::new($false))
    if($captureError) {
        $diagnostic=@{stage=$stage;frame=$file;surface=$surface;captureHandle=$captureHandle.ToInt64();message=$captureError.Exception.Message;exceptionType=$captureError.Exception.GetType().FullName;errorId=$captureError.FullyQualifiedErrorId}
        [System.IO.File]::WriteAllText((Join-Path $Output 'capture-error.json'),($diagnostic | ConvertTo-Json -Depth 5),[System.Text.UTF8Encoding]::new($false))
    }
}
if($captureError){throw $captureError}
