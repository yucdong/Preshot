param([ValidateSet('intro','library','columns','tour','export')][string]$Phase='intro',[string]$Work='.preshot-build-cache/installed-demo')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'demo-native-tools.ps1')
$workRoot=(Resolve-Path $Work).Path
$appId=[int](Get-Content (Join-Path $workRoot 'app-pid.txt'))
$script:DemoHandle=(Get-Process -Id $appId).MainWindowHandle
[DemoNative]::ShowWindow($script:DemoHandle,9) | Out-Null
[DemoNative]::SetForegroundWindow($script:DemoHandle) | Out-Null
$output=Join-Path $workRoot $Phase
if (Test-Path -LiteralPath (Join-Path $output 'frames.json')) { throw "Recording already exists: $output; use a fresh phase directory for a new take" }
New-Item -ItemType Directory -Force $output | Out-Null
$chapters=[System.Collections.Generic.List[object]]::new()
$capture=Start-Process powershell -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'capture-demo-window.ps1'),'-AppId',$appId,'-Output',('"'+$output+'"')) -PassThru
function Chapter([string]$Zh,[string]$En) {
    $chapters.Add(@{ timestamp=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();zh=$Zh;en=$En })
    Write-Output $Zh
}
function Create-Material([string]$Category,[string]$Name,[string]$Description,[hashtable]$Fields,[string[]]$Photos) {
    Click-Demo '创建素材' 'Button'
    Click-Demo $Category 'Button'
    Set-DemoText '素材名称' $Name
    Set-DemoText '素材说明' $Description
    Set-DemoText '标签' '南京，长江大桥，风光人像'
    foreach($key in $Fields.Keys){Set-DemoText $key $Fields[$key]}
    Click-Demo '添加图片' 'Button'
    $files=@($Photos | ForEach-Object {'"'+(Resolve-Path ('docs/demo/photos/'+$_)).Path+'"'}) -join ' '
    Select-DemoFile $files
    Start-Sleep -Seconds 2
    Save-DemoFrame $script:DemoHandle (Join-Path $workRoot ('material-'+$Photos[0]+'.png'))
    Click-Demo '保存素材' 'Button'
    Wait-DemoGone '保存素材' 'Button'
    $null=Wait-DemoElement ('选择素材：'+$Name) 'Button'
}
$failure=$null
try {
    Start-Sleep -Seconds 2
    if ($Phase -eq 'intro') {
        Chapter '安装后首次启动：完整离线演示项目已就绪' 'First launch: the complete offline sample is ready'
        Save-DemoFrame $script:DemoHandle (Join-Path $workRoot 'installed-starter.png')
        Start-Sleep -Seconds 2
        Chapter '新建拍摄项目：选择父目录并命名' 'Create a shoot: choose a parent folder and name'
        Click-Demo '新建项目' 'Button'
        Set-DemoText '项目所在路径' (Join-Path $workRoot 'profile\.preshot\projects')
        Set-DemoText '项目名称' '南京长江大桥 · 新建演示'
        Click-Demo '创建项目' 'Button'
        Start-Sleep -Seconds 2
        Chapter '写下拍摄主题、时间安排与镜头清单' 'Write the concept, schedule and shot list'
        Add-DemoText '南京长江大桥 · 江风与人像' '# '
        Add-DemoText '虚构模特 A，透明伞与泡泡机。从日落到蓝调，用桥梁线条交代环境，再靠近人物情绪。'
        Add-DemoText '16:30 集合 → 17:00 透明伞逆光 → 17:30 泡泡与江风 → 18:00 蓝调桥景'
        Chapter '插入单张图片：上传、嵌入与截图入口' 'Insert an image: upload, embed and screenshot tools'
        Add-DemoBlock '图片'
        Start-Sleep -Seconds 1
        Save-DemoFrame $script:DemoHandle (Join-Path $workRoot 'image-panel.png')
        Click-Demo '上传图片' 'Button'
        Select-DemoFile ((Resolve-Path 'docs/demo/photos/bridge-day.jpg').Path)
        $null=Wait-DemoElement '已保存所有更改' 'Text'
        Start-Sleep -Seconds 2
    } elseif ($Phase -eq 'library') {
        Chapter '构建素材库：地点资料与桥景照片一起保存' 'Build a library: save the location and its bridge photograph'
        Click-Demo '素材库' 'Button'
        Create-Material '场地' '南京长江大桥' '江边公共步道，日落与蓝调人像' @{'场地名称'='南京长江大桥';'场地信息'='选择允许停留的江边步道；注意风向与行人。'} @('bridge-day.jpg')
        Chapter '虚构模特 A：人物资料、描述和样片' 'Fictional Model A: profile, notes and sample illustration'
        Create-Material '模特' '模特 A' '虚构的风光人像示例人物' @{'模特名称 / 编号'='模特 A（虚构）';'其他信息'='浅色服装；缓慢行走、侧身回望。样片为原创示意图。'} @('model-a.png')
        Chapter '道具与服装：透明伞和泡泡机都有样例图片' 'Props and clothing: umbrella and bubble-machine sample images'
        Create-Material '道具与服装' '透明伞' '逆光轮廓与画面前景' @{'道具与服装信息'='透明伞 · 道具箱 · 大风时收起'} @('transparent-umbrella.png')
        Create-Material '道具与服装' '泡泡机' '顺风侧放置，营造轻盈前景' @{'道具与服装信息'='泡泡机 · 道具箱 · 避免地面湿滑'} @('bubble-machine.png')
        Chapter '保存图片组与单图素材，按描述和关键词检索' 'Save groups and individual images with searchable descriptions and tags'
        Create-Material '图片组' '桥畔光线参考' '白天与蓝调的光线和构图对照' @{} @('bridge-day.jpg','bridge-night.jpg')
        Create-Material '图片' '蓝调桥景' '夜景光线参考' @{} @('bridge-night.jpg')
        Start-Sleep -Seconds 2
        Click-Demo '关闭素材库' 'Button'
     } elseif ($Phase -eq 'columns') {
        Chapter '拖动 block 到右侧边缘，自动生成双栏' 'Drag a block to the right edge to create two columns'
        try { $null=Get-DemoElement '17:00 · 透明伞逆光' 'Text' } catch { Add-DemoText '17:00 · 透明伞逆光'; Add-DemoText '17:30 · 泡泡与江风' }
        New-DemoColumns '17:30 · 泡泡与江风' '17:00 · 透明伞逆光'
        Save-DemoFrame $script:DemoHandle (Join-Path $workRoot 'columns-created.png')
        Start-Sleep -Seconds 2
        Chapter '检索素材并插入当前项目，图片随内容一起复制' 'Search and reuse materials with independent image copies'
        foreach($name in @('南京长江大桥','模特 A','透明伞','泡泡机','桥畔光线参考','蓝调桥景')) {
            Set-DemoDocumentEnd
            Click-Demo '素材库' 'Button'
            Set-DemoText '搜索素材名称、标签和全部文字' $name
            Click-Demo ('选择素材：'+$name) 'Button'
            if($name -eq '模特 A') {
                Click-Demo '预览' 'Button'
                Start-Sleep -Seconds 2
                Click-Demo '关闭完整组件预览' 'Button'
            }
            Click-Demo '插入到当前文档' 'Button'
            if($name -eq '桥畔光线参考') {
                Chapter '图片组可选取图片，并选择组或单图插入' 'Choose group images and insert as a group or individual images'
                Start-Sleep -Seconds 2
                Click-Demo '确认插入' 'Button'
            }
            Wait-DemoGone '关闭素材库' 'Button'
            Start-Sleep -Seconds 1
        }
        Save-DemoFrame $script:DemoHandle (Join-Path $workRoot 'materials-inserted.png')
    } elseif ($Phase -eq 'tour') {
        Chapter '打开预置的完整离线样例，继续编辑拍摄方案' 'Open the complete bundled sample and continue editing'
        Click-Demo '打开项目 南京长江大桥 · 演示项目' 'Button'
        Click-Demo '缩小画布' 'Button'
        Click-Demo '缩小画布' 'Button'
        Start-Sleep -Seconds 1
        Chapter '地点与模特双栏展示，图片随栏宽等比缩放' 'Location and model cards in two columns with proportional images'
        $null=Show-DemoElement '01 地点与人物'
        $null=Show-DemoElement '02 道具与服装'
        Start-Sleep -Seconds 2
        Save-DemoFrame $script:DemoHandle (Join-Path $workRoot 'component-cards.png')
        Chapter '透明伞、泡泡机和服装组成三栏，均包含样例图片' 'Three columns: umbrella, bubble machine and clothing with images'
        $null=Show-DemoElement '03 光线与画面参考'
        Start-Sleep -Seconds 2
        Save-DemoFrame $script:DemoHandle (Join-Path $workRoot 'component-props.png')
        Chapter '图片组对比日间与蓝调桥景，可继续从素材库追加' 'Compare day and blue-hour references in an editable image group'
        $null=Show-DemoElement '04 拍摄流程'
        Start-Sleep -Seconds 2
        Save-DemoFrame $script:DemoHandle (Join-Path $workRoot 'component-gallery.png')
        Chapter '表格、镜头列表和检查清单，让现场执行更清晰' 'A schedule table, shot list and checklist organize the shoot'
        $null=Show-DemoElement '现场提醒（点击箭头展开）'
        Start-Sleep -Seconds 2
        Save-DemoFrame $script:DemoHandle (Join-Path $workRoot 'component-table.png')
        Chapter '离线视频、音频、附件及代码块补充拍摄信息' 'Offline video, audio, attachments and camera-setting notes'
        $null=Show-DemoElement '05 动态参考与附件'
        $null=Show-DemoElement '由 Jack No1 的桥景照片制作 · CC BY 3.0'
        Click-Demo 'play' 'Button' 0
        Start-Sleep -Seconds 5
        Save-DemoFrame $script:DemoHandle (Join-Path $workRoot 'component-video.png')
        $null=Show-DemoElement '人工合成提示音'
        Click-Demo 'play' 'Button' 1
        Start-Sleep -Seconds 4
        $null=Show-DemoElement '如何修改这份样例'
        Save-DemoFrame $script:DemoHandle (Join-Path $workRoot 'component-attachments.png')
        Start-Sleep -Seconds 2
    } elseif ($Phase -eq 'export') {
        Chapter '导出完整样例 PDF，保留图片与多栏布局' 'Export the complete sample PDF with images and columns'
        Click-Demo '导出' 'Button'
        Start-Sleep -Seconds 1
        Click-Demo '导出 PDF' 'MenuItem'
        Select-DemoFile (Join-Path $workRoot 'nanjing-bridge.pdf')
        for($n=0;$n -lt 120;$n++) {
            if(Test-Path -LiteralPath (Join-Path $workRoot 'nanjing-bridge.pdf')) { break }
            Start-Sleep -Milliseconds 500
        }
        if(-not(Test-Path -LiteralPath (Join-Path $workRoot 'nanjing-bridge.pdf'))) { throw 'Exported PDF missing' }
        Start-Sleep -Seconds 2
        Save-DemoFrame $script:DemoHandle (Join-Path $workRoot 'export-complete.png')
    } else { throw 'Unsupported phase' }
} catch { $failure=$_.Exception.Message; Write-Output $failure }
finally {
    New-Item -ItemType File -Path (Join-Path $output 'stop') -Force | Out-Null
    if (-not $capture.WaitForExit(30000)) { throw 'Window recorder did not finish' }
    if ($capture.ExitCode -ne 0) { throw "Window recorder failed: $($capture.ExitCode)" }
    $data=Get-Content (Join-Path $output 'frames.json') -Raw | ConvertFrom-Json
    $timeline=@($chapters.ToArray() | ForEach-Object { @{seconds=($_.timestamp-$data.started)/1000;zh=$_.zh;en=$_.en} })
    $recording=@{phase=$Phase;chapters=$timeline;frames=$data.frames;duration=$data.duration;errors=@($(if($failure){$failure}))}
    [System.IO.File]::WriteAllText((Join-Path $output 'recording.json'),($recording|ConvertTo-Json -Depth 8),[System.Text.UTF8Encoding]::new($false))
    Save-DemoFrame $script:DemoHandle (Join-Path $output 'last.png')
}
if($failure){throw $failure}
