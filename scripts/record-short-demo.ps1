param([ValidateSet('author','reuse','layout','details','export','material')][string]$Phase='author',[string]$Work='.preshot-build-cache/installed-demo-short')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'demo-native-tools.ps1')
$workRoot=(Resolve-Path $Work).Path
$appId=[int](Get-Content (Join-Path $workRoot 'app-pid.txt'))
$script:DemoHandle=(Get-Process -Id $appId).MainWindowHandle
[DemoNative]::ShowWindow($script:DemoHandle,9) | Out-Null
$output=Join-Path $workRoot $Phase
if(Test-Path -LiteralPath $output){throw "Use a fresh take directory: $output"}
New-Item -ItemType Directory $output | Out-Null
$chapters=[System.Collections.Generic.List[object]]::new()
$capture=Start-Process powershell -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'capture-demo-window.ps1'),'-AppId',$appId,'-Output',('"'+$output+'"')) -PassThru
function Chapter([string]$Zh,[string]$En,[double]$Seconds) {
    $chapters.Add(@{timestamp=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();zh=$Zh;en=$En;targetSeconds=$Seconds})
    Write-Output $Zh
}
function Insert-Material([string]$Name,[bool]$Group=$false) {
    Set-DemoDocumentEnd
    Click-Demo '素材库' 'Button'
    Set-DemoText '搜索素材名称、标签和全部文字' $Name
    Click-Demo ('选择素材：'+$Name) 'Button'
    Click-Demo '插入到当前文档' 'Button'
    if($Group){Click-Demo '确认插入' 'Button'}
    Wait-DemoGone '关闭素材库' 'Button'
    Start-Sleep -Milliseconds 700
}
$failure=$null
try {
    Start-Sleep -Seconds 2
    if($Phase -eq 'author') {
        Chapter '从空工作区新建项目' 'Start a new project in an empty workspace' 4
        Click-Demo '新建项目' 'Button'
        Set-DemoText '项目所在路径' (Join-Path $workRoot 'profile\.preshot\projects')
        Set-DemoText '项目名称' '南京长江大桥 · 江风人像'
        Start-Sleep -Milliseconds 800
        Click-Demo '创建项目' 'Button'
        $null=Wait-DemoElement '' 'Edit'
        Save-DemoFrame $script:DemoHandle (Join-Path $workRoot 'blank-project.png')
        Chapter '写下主题与拍摄安排' 'Write the concept and shooting schedule' 6
        Add-DemoText '南京长江大桥 · 江风人像' '# '
        Add-DemoText '日落到蓝调，记录江风中的轻盈瞬间。模特 A（虚构）搭配透明伞与泡泡机。'
        Add-DemoText '17:00 · 透明伞逆光'
        Add-DemoText '17:30 · 泡泡与江风'
        Chapter '拖动文字块，自动生成双栏' 'Drag a block beside another to create columns' 4
        New-DemoColumns '17:30 · 泡泡与江风' '17:00 · 透明伞逆光'
        Start-Sleep -Seconds 1
    } elseif($Phase -eq 'reuse') {
        Chapter '素材已备好：地点、模特与道具一键复用' 'Reuse prepared location, model and prop materials' 10
        Insert-Material '南京长江大桥'
        Insert-Material '模特 A'
        Insert-Material '透明伞'
        Insert-Material '泡泡机'
        Chapter '插入图片组，整理日落与蓝调参考' 'Insert an image group for the lighting references' 5
        Insert-Material '桥畔光线参考' $true
        Start-Sleep -Seconds 2
    } elseif($Phase -eq 'layout') {
        Chapter '补充执行清单，方案自动保存' 'Add a checklist; the plan saves automatically' 4
        Add-DemoText '现场执行' '## '
        Add-DemoText '检查电池、存储卡与备用衣物' '- [ ] '
        Add-DemoText '留意江边风向，收好道具，不占用通道' '- [ ] '
        Start-Sleep -Seconds 1
    } elseif($Phase -eq 'details') {
        Chapter '按本次拍摄调整道具信息' 'Customize the props for this shoot' 3
        for($index=0;$index -lt 2;$index++) {
            $field=Show-DemoElement '道具名称' 'Edit' $index
            $field.SetFocus()
            $title=if($index -eq 0){'泡泡机'}else{'透明伞'}
            ($field.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue($title)
            Send-DemoKeys '{TAB}'
        }
        Start-Sleep -Seconds 1
    } elseif($Phase -eq 'export') {
        Chapter '导出 PDF，与团队分享拍摄方案' 'Export the shooting plan as a PDF' 3
        Click-Demo '导出' 'Button'
        Click-Demo '导出 PDF' 'MenuItem'
        Select-DemoFile (Join-Path $workRoot 'nanjing-bridge.pdf')
        for($n=0;$n -lt 120;$n++) {
            if(Test-Path -LiteralPath (Join-Path $workRoot 'nanjing-bridge.pdf')){break}
            Start-Sleep -Milliseconds 500
        }
        if(-not(Test-Path -LiteralPath (Join-Path $workRoot 'nanjing-bridge.pdf'))){throw 'PDF export missing'}
        Start-Sleep -Seconds 1
    } elseif($Phase -eq 'material') {
        Chapter '最后创建一个素材：名称、描述与关键词' 'Create a material with a name, description and tags' 5
        Click-Demo '素材库' 'Button'
        Set-DemoText '搜索素材名称、标签和全部文字' ''
        Click-Demo '创建素材' 'Button'
        Click-Demo '道具与服装' 'Button'
        Set-DemoText '素材名称' '透明伞 · 逆光拍摄'
        Set-DemoText '素材说明' '桥畔日落人像，透明伞保留光线与人物轮廓。'
        Set-DemoText '标签' '透明伞，逆光，南京，风光人像'
        Set-DemoText '道具与服装名称' '透明伞'
        Set-DemoText '道具与服装信息' '透明伞 · 一把 · 大风时收起'
        Chapter '添加样例图片，保存后可在其他项目复用' 'Add a sample image and save for your next project' 7
        Click-Demo '添加图片' 'Button'
        Select-DemoFile ((Resolve-Path 'docs/demo/photos/transparent-umbrella.png').Path)
        Start-Sleep -Seconds 1
        Save-DemoFrame $script:DemoHandle (Join-Path $workRoot 'new-material.png')
        Click-Demo '保存素材' 'Button'
        Wait-DemoGone '保存素材' 'Button'
        Click-Demo '选择素材：透明伞 · 逆光拍摄' 'Button'
        Click-Demo '预览' 'Button'
        Start-Sleep -Seconds 3
    }
} catch { $failure=$_.Exception.Message; Write-Output $failure }
finally {
    New-Item -ItemType File -Path (Join-Path $output 'stop') -Force | Out-Null
    if(-not $capture.WaitForExit(30000)){throw 'Recorder did not finish'}
    if($capture.ExitCode -ne 0){throw "Recorder failed: $($capture.ExitCode)"}
    $data=Get-Content (Join-Path $output 'frames.json') -Raw | ConvertFrom-Json
    $timeline=@($chapters.ToArray() | ForEach-Object { @{seconds=($_.timestamp-$data.started)/1000;zh=$_.zh;en=$_.en;targetSeconds=$_.targetSeconds} })
    @{phase=$Phase;chapters=$timeline;frames=$data.frames;duration=$data.duration;errors=@($(if($failure){$failure}))} | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $output 'recording.json')
    Save-DemoFrame $script:DemoHandle (Join-Path $output 'last.png')
}
if($failure){throw $failure}
