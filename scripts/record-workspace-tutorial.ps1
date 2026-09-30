param([ValidateSet('W01','W02')][string]$Case='W01',[Parameter(Mandatory)][string]$Work)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'demo-native-tools.ps1')
. (Join-Path $PSScriptRoot 'demo-native-session.ps1')
$session=Assert-DemoNativeSession $Work
$workRoot=$session.WorkRoot
$appId=$session.AppId
$script:DemoHandle=$session.Handle
$version=$session.Version
$output=Assert-DemoOwnedPath (Join-Path $workRoot $Case) $session.CacheRoot $false
if(Test-Path -LiteralPath $output){throw 'Archive the previous take first'}
if($Case -eq 'W01') {
    $sourceProject='南京长江大桥 · 演示项目'
    $sourceRoot=Assert-DemoOwnedPath (Join-Path $session.ProfileRoot ('projects/'+$sourceProject)) $session.CacheRoot
    $sourceManifest=Assert-DemoOwnedPath (Join-Path $sourceRoot '.preshotproj') $session.CacheRoot
    $source=Get-Content -LiteralPath $sourceManifest -Raw -Encoding UTF8 | ConvertFrom-Json
    $workspace=Get-Content -LiteralPath (Assert-DemoOwnedPath (Join-Path $session.ProfileRoot 'workspace.json') $session.CacheRoot) -Raw -Encoding UTF8 | ConvertFrom-Json
    $matching=@($workspace.workspace.projects | Where-Object {$_.name -ceq $sourceProject})
    if($matching.Count -ne 1 -or $matching[0].projectId -cne $source.id -or (Assert-DemoOwnedPath $matching[0].path $session.CacheRoot) -ine $sourceRoot){throw 'Source project name, registry path and manifest identity must match exactly'}
    $sourceEntry=$matching[0]
    if(Test-Path -LiteralPath (Join-Path $session.ProfileRoot 'projects/南京长江大桥 · 独立副本')){throw 'The tutorial copy already exists; do not duplicate this take'}
}
New-Item -ItemType Directory $output | Out-Null
$chapters=[Collections.Generic.List[object]]::new()
function Chapter([string]$Zh,[string]$En,[double]$Seconds=7) {
    $chapters.Add(@{timestamp=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();zh=$Zh;en=$En;targetSeconds=$Seconds})
    Write-Output $Zh
}
function Choose-Setting([string]$Name,[string]$Field,[string]$Value) {
    Start-Sleep -Milliseconds 600
    $button=Wait-DemoElement $Name 'Button'
    $rect=$button.Current.BoundingRectangle
    if($button.Current.IsOffscreen -or $rect.Width -le 0){throw 'Setting control is not visible'}
    # Exercise real hit-testing, including any editor controls behind the modal.
    # A successful input call is not evidence that the setting changed.
    [void][DemoNative]::SetForegroundWindow($script:DemoHandle)
    if([DemoNative]::GetForegroundWindow() -ne $script:DemoHandle){throw 'Owned settings window must be foreground before clicking'}
    [DemoNative]::Click([int]($rect.X+$rect.Width/2),[int]($rect.Y+$rect.Height/2))
    for($attempt=0;$attempt -lt 40;$attempt++) {
        Start-Sleep -Milliseconds 250
        # A fresh profile has no settings file until the first debounced save.
        if(-not (Test-Path -LiteralPath (Join-Path $session.ProfileRoot 'settings.json'))){continue}
        $settings=Get-Content -LiteralPath (Join-Path $session.ProfileRoot 'settings.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        if($settings.$Field -ceq $Value){Start-Sleep -Milliseconds 450;return}
    }
    throw ('Setting did not persist: '+$Field+'='+$Value)
}
$capture=Start-Process powershell -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'capture-demo-window.ps1'),'-AppId',$appId,'-Output',('"'+$output+'"')) -PassThru
$failure=$null
try {
    Start-Sleep -Seconds 2
    if($Case -eq 'W01') {
        Chapter '从项目菜单复制完整拍摄方案' 'Copy the complete shooting plan from its project menu'
        Click-Demo ('更多项目操作 '+$sourceProject) 'Button'
        Click-Demo '复制项目' 'MenuItem'
        $null=Wait-DemoElement $sourceEntry.path 'Text'
        Chapter '选择副本的父目录和新名称' 'Choose the parent directory and a new project name'
        Set-DemoText '存放目录' (Join-Path $workRoot 'profile\.preshot\projects')
        Set-DemoText '新项目名称' '南京长江大桥 · 独立副本'
        Save-DemoFrame $script:DemoHandle (Join-Path $output 'copy-dialog.png')
        Chapter '保存原项目，复制本地文件，然后自动打开副本' 'Save the source, copy local files and open the new project' 8
        Click-Demo '复制项目' 'Button'
        Wait-DemoGone '复制项目' 'Button'
        $null=Wait-DemoElement '关闭项目 南京长江大桥 · 独立副本' 'Button'
        $copyManifest=Assert-DemoOwnedPath (Join-Path $session.ProfileRoot 'projects/南京长江大桥 · 独立副本/.preshotproj') $session.CacheRoot
        $original=Get-Content -LiteralPath $sourceManifest -Raw -Encoding UTF8 | ConvertFrom-Json
        $duplicate=Get-Content -LiteralPath $copyManifest -Raw -Encoding UTF8 | ConvertFrom-Json
        if($original.id -cne $source.id -or $duplicate.id -ceq $original.id){throw 'Copy did not preserve the pinned source identity and allocate its own identity'}
        # Only the plan title changes during copy; its document/components must
        # still match the source before adding the copy-only paragraph.
        $duplicate.plan.title=$original.plan.title
        if(($duplicate.plan | ConvertTo-Json -Depth 100 -Compress) -cne ($original.plan | ConvertTo-Json -Depth 100 -Compress)){throw 'Copied document/components do not match the pinned source'}
        @{sourceProject=$sourceProject;sourceProjectId=$source.id;copyProjectId=$duplicate.id;sourcePath=$sourceEntry.path;contentComparedBeforeEdit=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'copy-source.json') -Encoding UTF8
        Chapter '原项目保持打开，副本可以独立编辑' 'The original stays open while you edit the independent copy' 8
        Set-DemoDocumentEnd
        Add-DemoText '副本独立补充：再次确认设备和集合时间。'
        # The document autosaves; verify the saved copy below before continuing.
        Start-Sleep -Seconds 2
        $saved=$false
        for($attempt=0;$attempt -lt 40;$attempt++) {
            if((Get-Content -LiteralPath $copyManifest -Raw -Encoding UTF8).Contains('副本独立补充：再次确认设备和集合时间。')) {$saved=$true;break}
            Start-Sleep -Milliseconds 250
        }
        if(-not $saved){throw 'The independent copy did not persist the new text'}
        Save-DemoFrame $script:DemoHandle (Join-Path $output 'independent-copy.png')
    } else {
        Chapter '在设置中切换界面语言' 'Switch the interface language in Settings'
        Click-Demo '设置' 'Button'
        Choose-Setting 'English' 'language' 'en'
        Save-DemoFrame $script:DemoHandle (Join-Path $output 'english-settings.png')
        Chapter '切换深色主题，项目内容保持原样' 'Use dark mode while keeping your document content unchanged'
        Choose-Setting 'Dark' 'theme' 'dark'
        Click-Demo 'Close settings' 'Button'
        Start-Sleep -Seconds 2
        Save-DemoFrame $script:DemoHandle (Join-Path $output 'english-dark.png')
        Chapter '语言与主题随时可以恢复' 'Change language and theme whenever needed'
        Click-Demo 'Settings' 'Button'
        Choose-Setting '简体中文' 'language' 'zh'
        Choose-Setting '浅色' 'theme' 'light'
        Click-Demo '关闭设置' 'Button'
    }
    Start-Sleep -Seconds 2
} catch {$failure=$_.Exception.Message;Write-Output $failure}
finally {
    New-Item -ItemType File -Path (Join-Path $output 'stop') -Force | Out-Null
    if(-not $capture.WaitForExit(30000) -or $capture.ExitCode -ne 0){throw 'Window recorder failed'}
    $data=Get-Content (Join-Path $output 'frames.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $timeline=@($chapters.ToArray() | ForEach-Object {@{seconds=($_.timestamp-$data.started)/1000;zh=$_.zh;en=$_.en;targetSeconds=$_.targetSeconds}})
    @{phase=$Case;version=$version;chapters=$timeline;frames=$data.frames;duration=$data.duration;errors=@($(if($failure){$failure}));crop=@{x=10;y=51;width=1580;height=998}} | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $output 'recording.json')
    Save-DemoFrame $script:DemoHandle (Join-Path $output 'last.png')
}
if($failure){throw $failure}
