<#
Read-only desktop evidence plus an owned, discarded material draft. Run only
after other recordings finish, against the installed app in an isolated Work.

  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-native-capture-cancellation.ps1 -Work .preshot-build-cache/<work>

This checks system Escape cancellation, starting again, and in-app cancellation.
It never selects a capture rectangle, calls a clipboard API, saves the material,
or publishes a successful-capture tutorial. Successful Windows snipping uses
the live session clipboard in the application and is outside this test's scope.
Screenshots use PrintWindow on the Preshot window only.
#>
param([Parameter(Mandatory)][string]$Work)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'demo-native-tools.ps1')
. (Join-Path $PSScriptRoot 'demo-native-session.ps1')

$session = Assert-DemoNativeSession $Work
$cacheRoot = $session.CacheRoot
function Assert-IsolatedPath([string]$Path, [bool]$MustExist = $true) {
    return Assert-DemoOwnedPath $Path $cacheRoot $MustExist
}
$workRoot = $session.WorkRoot
$profileRoot = $session.ProfileRoot
$draftRoot = Assert-IsolatedPath (Join-Path $profileRoot 'library\drafts')
$appId = $session.AppId
$installedExe = $session.InstalledExe
$script:DemoHandle = $session.Handle
$output = Assert-IsolatedPath (Join-Path $workRoot 'C13-cancel-retry') $false
if (Test-Path -LiteralPath $output) { throw 'Archive the previous cancellation evidence before retrying' }

if (-not ('CaptureCancellationNative' -as [type])) {
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CaptureCancellationNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  public static void Escape() { keybd_event(27, 0, 0, UIntPtr.Zero); keybd_event(27, 0, 2, UIntPtr.Zero); }
}
'@
}
function Find-Element([string]$Name, [string]$Type = 'Button') {
    try { return Get-DemoElement $Name $Type } catch { return $null }
}
function Wait-CaptureOverlay {
    for ($attempt = 0; $attempt -lt 80; $attempt++) {
        $foreground = [CaptureCancellationNative]::GetForegroundWindow()
        $foregroundId = [uint32]0
        [void][CaptureCancellationNative]::GetWindowThreadProcessId($foreground, [ref]$foregroundId)
        $foregroundProcess = Get-Process -Id $foregroundId -ErrorAction SilentlyContinue
        if ($foregroundProcess -and $foregroundProcess.ProcessName -in @('ScreenClippingHost','SnippingTool','ScreenSketch')) {
            return $foregroundProcess.ProcessName
        }
        Start-Sleep -Milliseconds 250
    }
    throw 'Windows snipping overlay did not become foreground; no capture selection was attempted'
}
function Wait-CaptureReady {
    Wait-DemoGone '取消截图' 'Button'
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        $button = Find-Element '截图'
        if ($button -and $button.Current.IsEnabled) { return }
        Start-Sleep -Milliseconds 250
    }
    throw 'Screenshot did not become available again after cancellation'
}
function Start-VisibleCapture {
    $button=Wait-DemoElement '截图' 'Button'
    $rect=$button.Current.BoundingRectangle
    if($button.Current.IsOffscreen -or $rect.Width -le 0){throw 'Screenshot button must be visible'}
    [void][DemoNative]::SetForegroundWindow($script:DemoHandle)
    if([DemoNative]::GetForegroundWindow() -ne $script:DemoHandle){throw 'Owned app must be foreground before starting system snipping'}
    [DemoNative]::Click([int]($rect.X+$rect.Width/2),[int]($rect.Y+$rect.Height/2))
    $null=Wait-DemoElement '取消截图' 'Button'
}
function Read-Field([string]$Name) {
    return (Get-DemoElement $Name 'Edit').GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).Current.Value
}
function Assert-EmptyOwnedDraft {
    $manifest = Assert-IsolatedPath (Join-Path $script:OwnedDraft 'manifest.json')
    $draft = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
    if (@($draft.staged).Count -or @($draft.pending).Count -or @($draft.material.images).Count) {
        throw 'A cancelled capture unexpectedly added an image to the owned draft'
    }
    $files = @(Get-ChildItem -Force -LiteralPath $script:OwnedDraft -File)
    if ($files.Count -ne 1 -or $files[0].Name -ne 'manifest.json') {
        throw 'Cancelled capture left an unexpected file in the owned draft'
    }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $manifest).Hash -ne $script:DraftHash) {
        throw 'Cancellation changed the persisted owned draft'
    }
    if ((Read-Field '素材名称') -ne $script:MaterialName -or (Read-Field '素材说明') -ne $script:Description) {
        throw 'Cancellation lost the unsaved metadata fields'
    }
}

if (Find-Element '保存素材') { throw 'Finish the current material edit before running this independent test' }
New-Item -ItemType Directory -Path $output | Out-Null
$steps = [Collections.Generic.List[object]]::new()
$cleanupErrors = [Collections.Generic.List[string]]::new()
$failure = $null
$script:OwnedDraft = $null
$script:MaterialName = '截图取消验收 · 未保存 ' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$script:Description = '只验证取消和重试；不选择截图区域，不保存此草稿。'
$libraryWasOpen = $null -ne (Find-Element '关闭素材库')
$baselineDrafts = @(Get-ChildItem -LiteralPath $draftRoot -Directory | ForEach-Object Name)
try {
    [void][DemoNative]::ShowWindow($script:DemoHandle,9)
    [void][DemoNative]::SetForegroundWindow($script:DemoHandle)
    Save-DemoFrame $script:DemoHandle (Join-Path $output 'before.png')
    if (-not $libraryWasOpen) { Click-Demo '素材库' 'Button' }
    Click-Demo '创建素材' 'Button'
    Click-Demo '图片' 'Button'
    $null = Wait-DemoElement '保存素材' 'Button'
    $owned = @(Get-ChildItem -LiteralPath $draftRoot -Directory | Where-Object { $_.Name -notin $baselineDrafts })
    if ($owned.Count -ne 1) { throw 'Cannot identify the single draft created by this acceptance run' }
    $script:OwnedDraft = Assert-IsolatedPath $owned[0].FullName
    $script:DraftHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $script:OwnedDraft 'manifest.json')).Hash
    Set-DemoText '素材名称' $script:MaterialName
    Set-DemoText '素材说明' $script:Description
    Assert-EmptyOwnedDraft
    Save-DemoFrame $script:DemoHandle (Join-Path $output 'empty-draft.png')

    Start-VisibleCapture
    $overlay = Wait-CaptureOverlay
    # Physical Escape is intentionally limited to a confirmed foreground system
    # snipping process. It reaches the native cancellation observer; a posted
    # WebView Escape would test only the React shortcut instead.
    [CaptureCancellationNative]::Escape()
    Wait-CaptureReady
    Assert-EmptyOwnedDraft
    $steps.Add(@{ action='system-overlay-escape'; passed=$true; overlay=$overlay; draftUnchanged=$true })
    Save-DemoFrame $script:DemoHandle (Join-Path $output 'after-system-escape.png')

    Start-VisibleCapture
    $overlay = Wait-CaptureOverlay
    $steps.Add(@{ action='start-again'; passed=$true; overlay=$overlay })
    # Invoke the app's cancel control behind the overlay; the app dismisses its
    # own native session. No mouse-down or drag is sent to the snipping overlay.
    Click-Demo '取消截图' 'Button'
    Wait-CaptureReady
    Assert-EmptyOwnedDraft
    $steps.Add(@{ action='app-cancel'; passed=$true; draftUnchanged=$true; readyForNextCapture=$true })
    Save-DemoFrame $script:DemoHandle (Join-Path $output 'after-app-cancel.png')
} catch {
    $failure = $_.Exception.Message
} finally {
    if ($script:OwnedDraft) {
        try {
            if (Find-Element '取消截图') { Click-Demo '取消截图' 'Button'; Wait-CaptureReady }
            if (Find-Element '保存素材') {
                Click-Demo '取消' 'Button'
                if (Find-Element '放弃修改') { Click-Demo '放弃修改' 'Button' }
                Wait-DemoGone '保存素材' 'Button'
            }
            if (Test-Path -LiteralPath $script:OwnedDraft) { throw 'The discarded owned draft still exists' }
            $remaining = @(Get-ChildItem -LiteralPath $draftRoot -Directory | ForEach-Object Name)
            $beforeIds = [string]::Join('|', [string[]]@($baselineDrafts | Sort-Object))
            $afterIds = [string]::Join('|', [string[]]@($remaining | Sort-Object))
            if ($beforeIds -cne $afterIds) { throw 'Draft inventory differs after cleanup' }
            if (-not $libraryWasOpen -and (Find-Element '关闭素材库')) { Click-Demo '关闭素材库' 'Button' }
        } catch { $cleanupErrors.Add($_.Exception.Message) }
    }
    try { Save-DemoFrame $script:DemoHandle (Join-Path $output 'after-cleanup.png') }
    catch { $cleanupErrors.Add($_.Exception.Message) }
    $report = [ordered]@{
        case='C13-cancel-retry-only'; version=(Get-Item -LiteralPath $installedExe).VersionInfo.FileVersion;
        finishedAt=[DateTimeOffset]::UtcNow.ToString('o'); appId=$appId;
        passed=(-not $failure -and $cleanupErrors.Count -eq 0); steps=@($steps.ToArray());
        captureRectangleSelected=$false; clipboardApiCallsByDriver=0; materialSaved=$false;
        successfulCaptureVerified=$false; publishAsCaptureTutorial=$false;
        limitation='Successful Windows snipping uses the application session clipboard and is not unattended-tested here.';
        failure=$failure; cleanupErrors=@($cleanupErrors.ToArray())
    }
    $report | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $output 'acceptance.json')
    $report | ConvertTo-Json -Depth 8
}
if ($failure -or $cleanupErrors.Count) { throw 'Native capture cancellation acceptance failed; inspect its acceptance.json and screenshots' }
