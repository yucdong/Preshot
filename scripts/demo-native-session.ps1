# Read-only ownership checks shared by installed-app acceptance drivers.
# This file performs no UI actions and does not launch or terminate a process.
function Assert-DemoOwnedPath([string]$Path,[string]$CacheRoot,[bool]$MustExist=$true) {
    if($Path.StartsWith('\\?\')){$Path=$Path.Substring(4)}
    $absolute=[IO.Path]::GetFullPath($Path)
    $cache=[IO.Path]::GetFullPath($CacheRoot).TrimEnd('\')
    if(-not $absolute.StartsWith($cache+'\',[StringComparison]::OrdinalIgnoreCase)) {
        throw 'Demo acceptance paths must stay below the repository build cache'
    }
    $cursor=$absolute
    while($cursor.Length -ge $cache.Length) {
        if(Test-Path -LiteralPath $cursor) {
            if((Get-Item -Force -LiteralPath $cursor).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw 'Linked demo acceptance paths are not allowed'
            }
        } elseif($MustExist -and $cursor -eq $absolute) { throw 'Required demo acceptance path is missing' }
        $cursor=Split-Path $cursor -Parent
    }
    return $absolute
}

function Assert-DemoNativeSession([string]$Work) {
    $repository=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
    $cache=Join-Path $repository '.preshot-build-cache'
    $input=if([IO.Path]::IsPathRooted($Work)){$Work}else{Join-Path $repository $Work}
    $workRoot=Assert-DemoOwnedPath $input $cache
    $profileRoot=Assert-DemoOwnedPath (Join-Path $workRoot 'profile/.preshot') $cache
    $pidMarker=Assert-DemoOwnedPath (Join-Path $workRoot 'app-pid.txt') $cache
    $appId=[int](Get-Content -LiteralPath $pidMarker -Encoding UTF8)
    $app=Get-Process -Id $appId
    $installed=Join-Path $env:ProgramFiles 'Preshot/preshot.exe'
    if($app.Path -ine $installed -or $app.MainWindowHandle -eq [IntPtr]::Zero) {
        throw 'Demo session must be the installed Program Files executable with its main window'
    }
    if([Math]::Abs(((Get-Item -LiteralPath $pidMarker).LastWriteTimeUtc-$app.StartTime.ToUniversalTime()).TotalSeconds) -gt 30) {
        throw 'PID marker does not match the process start time; do not reuse a stale session'
    }
    # The trusted launcher binds the profile and WebView roots together. Check
    # its live child before any UI mutation, rather than trusting a bare PID.
    $webview=Assert-DemoOwnedPath (Join-Path $workRoot 'webview') $cache
    $children=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId = '+$appId) | Where-Object {
        $_.Name -ieq 'msedgewebview2.exe' -and $_.CommandLine -and
        $_.CommandLine.IndexOf($webview,[StringComparison]::OrdinalIgnoreCase) -ge 0
    })
    if($children.Count -ne 1) { throw 'Process does not own the expected isolated WebView directory' }
    $profile=Get-Content -LiteralPath (Assert-DemoOwnedPath (Join-Path $profileRoot 'profile.json') $cache) -Raw -Encoding UTF8 | ConvertFrom-Json
    $storage=Get-Content -LiteralPath (Assert-DemoOwnedPath (Join-Path $profileRoot 'storage.json') $cache) -Raw -Encoding UTF8 | ConvertFrom-Json
    if(-not $profile.setupConfirmed -or (Assert-DemoOwnedPath $profile.dataDirectory $cache) -ine $profileRoot -or
        (Assert-DemoOwnedPath $storage.libraryPath $cache) -ine (Join-Path $profileRoot 'library')) {
        throw 'Demo profile is not configured for its own isolated data and library directories'
    }
    return [pscustomobject]@{
        WorkRoot=$workRoot; ProfileRoot=$profileRoot; CacheRoot=$cache; AppId=$appId;
        Handle=$app.MainWindowHandle; InstalledExe=$installed;
        Version=(Get-Item -LiteralPath $installed).VersionInfo.FileVersion
    }
}
