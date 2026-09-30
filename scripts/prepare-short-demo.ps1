param(
    [Parameter(Mandatory)][string]$Work,
    [ValidateSet('walkthrough','tutorials')][string]$Mode='walkthrough'
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'demo-native-tools.ps1')
. (Join-Path $PSScriptRoot 'demo-native-session.ps1')
$workRoot=(Resolve-Path -LiteralPath $Work).Path
$cacheRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../.preshot-build-cache')).Path
$workRoot=Assert-DemoOwnedPath $workRoot $cacheRoot
$pidMarker=Assert-DemoOwnedPath (Join-Path $workRoot 'app-pid.txt') $cacheRoot
$app=Get-Process -Id ([int](Get-Content -LiteralPath $pidMarker -Encoding UTF8))
if($app.Path -ine (Join-Path $env:ProgramFiles 'Preshot/preshot.exe') -or $app.MainWindowHandle -eq [IntPtr]::Zero -or
    [Math]::Abs(((Get-Item -LiteralPath $pidMarker).LastWriteTimeUtc-$app.StartTime.ToUniversalTime()).TotalSeconds) -gt 30){throw 'The PID marker must identify this fresh installed-app session'}
$webview=Assert-DemoOwnedPath (Join-Path $workRoot 'webview') $cacheRoot
$children=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId = '+$app.Id) | Where-Object {
    $_.Name -ieq 'msedgewebview2.exe' -and $_.CommandLine -and $_.CommandLine.IndexOf($webview,[StringComparison]::OrdinalIgnoreCase) -ge 0
})
if($children.Count -ne 1){throw 'The app must own this recording workspace WebView directory'}
$script:DemoHandle=$app.MainWindowHandle
$profileRoot=Join-Path $workRoot 'profile\.preshot'
if(Test-Path -LiteralPath (Join-Path $workRoot 'prepared.json')){throw 'This recording workspace is already prepared'}
$setup=$null
try {$setup=Get-DemoElement '使用此目录并继续' 'Button'} catch { }
if($setup) {
    Set-DemoText '项目工作路径' $profileRoot
    Click-Demo '使用此目录并继续' 'Button'
    Wait-DemoGone '使用此目录并继续' 'Button'
}
$null=Wait-DemoElement '导出' 'Button'
$session=Assert-DemoNativeSession $workRoot
$projectsRoot=Assert-DemoOwnedPath (Join-Path $profileRoot 'projects') $cacheRoot
$projects=@(Get-ChildItem -LiteralPath $projectsRoot -Directory)
if($projects.Count -ne 1){throw 'Expected only the startup sample in this isolated profile'}
$sample=Assert-DemoOwnedPath $projects[0].FullName $cacheRoot
$null=Assert-DemoOwnedPath (Join-Path $sample '.preshotproj') $cacheRoot
$manifest=Get-Content -LiteralPath (Join-Path $sample '.preshotproj') -Raw -Encoding UTF8 | ConvertFrom-Json
$workspace=Get-Content -LiteralPath (Assert-DemoOwnedPath (Join-Path $profileRoot 'workspace.json') $cacheRoot) -Raw -Encoding UTF8 | ConvertFrom-Json
$registered=@($workspace.workspace.projects)
if($manifest.name -cne '南京长江大桥 · 演示项目' -or $registered.Count -ne 1 -or $registered[0].projectId -cne $manifest.id -or
    $registered[0].name -cne $manifest.name -or (Assert-DemoOwnedPath $registered[0].path $cacheRoot) -ine $sample){throw 'Only the exactly identified isolated startup sample may be archived'}
if(@($manifest.plan.artifacts | Where-Object {$_.kind -eq 'shootingLocation'})[0].gallery.images.Count -ne 3){throw 'The installed sample must include three location pictures'}
if($Mode -eq 'walkthrough') {
    foreach($entry in @(
        @{Button='南京长江大桥更多操作';Name='南京长江大桥'},
        @{Button='模特 A（虚构）更多操作';Name='模特 A'},
        @{Button='透明伞更多操作';Name='透明伞'},
        @{Button='泡泡机更多操作';Name='泡泡机'},
        @{Button='保存图片组到素材库';Name='桥畔光线参考'}
    )) {
        $null=Show-DemoDocumentTarget $entry.Button 'Button'
        Click-Demo $entry.Button 'Button'
        if($entry.Button -ne '保存图片组到素材库'){Click-Demo '保存到素材库' 'MenuItem'}
        Set-DemoText '素材名称' $entry.Name
        Set-DemoText '素材说明' '南京长江大桥风光人像参考；保留组件文字、图片与排版。'
        Set-DemoText '标签' '南京，长江大桥，风光人像'
        Click-Demo '保存素材' 'Button'
        Wait-DemoGone '保存素材' 'Button'
    }
}
# Removing from the list is a UI action. Archive only this owned startup folder;
# do not delete it and do not touch any real project/profile directory.
Click-Demo ('关闭项目 '+$manifest.name) 'Button'
Click-Demo '保存并关闭' 'Button'
Wait-DemoGone '保存并关闭' 'Button'
# The launcher has open/copy actions; removal lives in the project sidebar.
Click-Demo ('打开项目 '+$manifest.name) 'Button'
$null=Wait-DemoElement '导出' 'Button'
Click-Demo ('更多项目操作 '+$manifest.name) 'Button'
Click-Demo '删除项目' 'MenuItem'
Click-Demo '从列表移除' 'Button'
Wait-DemoGone '从列表移除' 'Button'
$archive=Assert-DemoOwnedPath (Join-Path $workRoot 'startup-sample-archive') $cacheRoot $false
if(Test-Path -LiteralPath $archive){throw 'Occupied archive path'}
$null=Assert-DemoOwnedPath $sample $cacheRoot
if(@(Get-ChildItem -LiteralPath $sample -Recurse -Force | Where-Object {$_.Attributes -band [IO.FileAttributes]::ReparsePoint}).Count){throw 'The owned sample cannot contain linked files or directories'}
Move-Item -LiteralPath $sample -Destination $archive
Save-DemoFrame $script:DemoHandle (Join-Path $workRoot 'empty-workspace.png')
if($Mode -eq 'tutorials') {
    Click-Demo '新建项目' 'Button'
    Set-DemoText '项目所在路径' $projectsRoot
    Set-DemoText '项目名称' '南京长江大桥 · 演示项目'
    Click-Demo '创建项目' 'Button'
    $null=Wait-DemoElement '导出' 'Button'
}
@{mode=$Mode;preparedAt=[DateTimeOffset]::UtcNow.ToString('o');archivedSample=$archive} | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $workRoot 'prepared.json')
