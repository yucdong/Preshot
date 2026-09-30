param([ValidateSet('author','reuse','layout','details','export','material')][string]$Phase='author',[string]$Work='.preshot-build-cache/installed-demo-short')
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'demo-native-tools.ps1')
. (Join-Path $PSScriptRoot 'demo-native-session.ps1')
$session=Assert-DemoNativeSession $Work
$workRoot=$session.WorkRoot
$appId=$session.AppId
$demoVersion=$session.Version
$script:DemoHandle=$session.Handle
[DemoNative]::ShowWindow($script:DemoHandle,9) | Out-Null
$output=Assert-DemoOwnedPath (Join-Path $workRoot $Phase) $session.CacheRoot $false
if(Test-Path -LiteralPath $output){throw "Use a fresh take directory: $output"}
New-Item -ItemType Directory $output | Out-Null
$chapters=[System.Collections.Generic.List[object]]::new()
$capture=Start-Process powershell -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'capture-demo-window.ps1'),'-AppId',$appId,'-Output',('"'+$output+'"')) -PassThru
function Chapter([string]$Zh,[string]$En,[double]$Seconds) {
    $chapters.Add(@{timestamp=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();zh=$Zh;en=$En;targetSeconds=$Seconds})
    Write-Output $Zh
}
function Insert-Material([string]$Name,[bool]$Group=$false,[string]$Anchor) {
    Focus-DemoDocumentText $Anchor
    Click-Demo '素材库' 'Button'
    Set-DemoText '搜索素材名称、标签和全部文字' $Name
    Click-Demo ('选择素材：'+$Name) 'Button'
    Click-Demo '插入到当前文档' 'Button'
    if($Group){Click-Demo '确认插入' 'Button';Wait-DemoGone '确认插入' 'Button'}
    Wait-DemoGone '关闭素材库' 'Button'
    Start-Sleep -Milliseconds 700
}
function Add-DemoText([string]$Text,[string]$Prefix='') {
    if($Prefix){[DemoNative]::Characters($script:DemoHandle,$Prefix);Start-Sleep -Milliseconds 350}
    [DemoNative]::Characters($script:DemoHandle,$Text)
    Start-Sleep -Milliseconds 400
    Send-DemoKeys '{ENTER}'
    Start-Sleep -Milliseconds 350
}
function New-DemoPropColumns {
    Click-Demo '恢复 100% 缩放' 'Button'
    Click-Demo '缩小画布' 'Button'
    $null=Show-DemoDocumentTarget '泡泡机更多操作' 'Button'
    $toolbar=(Get-DemoElement '导出' 'Button').Current.BoundingRectangle
    for($attempt=0;$attempt -lt 8;$attempt++) {
        $r=(Get-DemoElement '泡泡机更多操作' 'Button').Current.BoundingRectangle
        if($r.Top -le $toolbar.Bottom+100){break}
        $point=[IntPtr]((([int]($toolbar.Bottom+180)) -shl 16) -bor ([int]($r.X-100)))
        [DemoNative]::PostMessage([DemoNative]::Renderer($script:DemoHandle),0x020A,[IntPtr](-120 -shl 16),$point)|Out-Null
        Start-Sleep -Milliseconds 500
    }
    $source=(Get-DemoElement '泡泡机更多操作' 'Button').Current.BoundingRectangle
    $target=(Get-DemoElement '透明伞更多操作' 'Button').Current.BoundingRectangle
    $editor=(Get-DemoElement '' 'Edit').Current.BoundingRectangle
    $window=New-Object DemoNative+RECT
    [DemoNative]::GetWindowRect($script:DemoHandle,[ref]$window)|Out-Null
    if($source.Top -lt $toolbar.Bottom+8 -or $target.Bottom -gt $window.Bottom-40){throw 'Both prop headers must be visible before dragging'}
    Move-DemoPointer ([int]($editor.X+18)) ([int]($source.Y+8))
    $handle=(Get-DemoElement '打开菜单' 'Button').Current.BoundingRectangle
    Drag-DemoPointer ([int]($handle.X+$handle.Width/2)) ([int]($handle.Y+$handle.Height/2)) ([int]($editor.Right-3)) ([int]($target.Y+8))
    # Read the saved result to verify that the visible drag really committed.
    $manifest=Join-Path $workRoot 'profile\.preshot\projects\南京长江大桥 · 江风人像\.preshotproj'
    $matched=$false
    for($attempt=0;$attempt -lt 30;$attempt++) {
        Start-Sleep -Milliseconds 500
        $plan=(Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json).plan
        $props=@($plan.artifacts | Where-Object {$_.kind -eq 'prop'} | ForEach-Object {$_.id})
        foreach($row in @($plan.document.blocks | Where-Object {$_.type -eq 'columnList'})) {
            $ids=@($row.children | ForEach-Object {$_.children} | ForEach-Object {$_.props.artifactId})
            if($row.children.Count -eq 2 -and $ids -contains $props[0] -and $ids -contains $props[1]){$matched=$true}
        }
        if($matched){break}
    }
    if(-not $matched){throw 'The drag did not commit the two prop cards in one row'}
    Focus-DemoDocumentText '03 道具与执行方法'
    Start-Sleep -Seconds 2
    Save-DemoFrame $script:DemoHandle (Join-Path $workRoot 'props-two-columns.png')
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
        Chapter '写下主题、成片目标与拍摄安排' 'Write the concept, shot goals and schedule' 7
        Set-DemoDocumentEnd
        Add-DemoText '南京长江大桥 · 江风人像' '# '
        Add-DemoText '主题：日落到蓝调，记录江风中的轻盈瞬间。虚构模特 A 搭配透明伞与泡泡机，以桥梁线条交代环境，再靠近人物情绪。'
        Add-DemoText '成片目标：12 张精修，环境人像、透明伞、泡泡前景、蓝调桥景各 3 张；每组保留横竖构图。服装以米白和浅灰为主，避免大面积图案抢夺画面。'
        Add-DemoText '01 拍摄安排' '## '
        Add-DemoText '16:30 集合踩点：确认日落方位、风向、背景和公共步道通行情况；先拍一组无道具环境人像。'
        Add-DemoText '17:00 透明伞逆光 → 17:30 泡泡与江风 → 18:00 蓝调桥景。当天按实际日落时间调整；每个机位先远景、再中景、最后特写。'
        Add-DemoText '02 场地与人物参考' '## '
        Add-DemoText '构图提示：三张桥景分别观察引导线、整体层次和灯光；实拍停留在允许进入的江岸区域，桥柱与地平线避开人物头部。'
        Add-DemoText '模特 A · 三种姿态' '### '
        Add-DemoText '动作沟通：一次只给一个指令，先做静止、再转身、最后慢走。回看眼神、手指和衣摆，姿态自然后再加道具。'
        Add-DemoText '03 道具与执行方法' '## '
        Add-DemoText '04 光线参考' '## '
        Add-DemoText '05 拍照要点' '## '
        Add-DemoText '环境人像：35mm 起步，人物位于三分之一处，桥梁引导线伸向远方；机位略低于眼睛，保持桥梁水平。留出人物视线方向和行走方向的空间。'
        Add-DemoText '逆光与透明伞：50–85mm、f/2.8–4，移动人物从 1/500s 起步，ISO 随现场调整。伞面略向后倾，伞骨避开眼睛；检查面部与伞沿高光，需要时用白色反光板轻补。'
        Add-DemoText '泡泡前景：助手从侧上风方向少量试喷，泡泡穿过镜头前方但不挡住眼睛。连续对焦跟住近侧眼睛，短连拍 3–5 张；避免泡泡液沾到镜头和行人。'
        Add-DemoText '蓝调桥景：人物保持静止，从 1/160s 起步，提高 ISO 保住清晰度。保留桥灯层次，统一白平衡，分别拍环境中景、半身和一张无人的桥景作为收尾。以上参数都是起点。'
        Add-DemoText '06 现场检查与交付' '## '
        Add-DemoText '准备电池、存储卡、两瓶泡泡液、擦拭布、反光板和备用衣物。' '- [ ] '
        Add-DemoText '每组回看对焦、眼神、手指、衣摆与背景穿帮；横竖画面都留一份。' '- [ ] '
        Add-DemoText '不进入车行道、铁路和封闭区域；不占通道，大风收伞，及时清理湿滑地面。' '- [ ] '
        # End the checklist before the weather, delivery and image-credit prose.
        Send-DemoKeys '{ENTER}'
        Add-DemoText '阴天改拍低饱和线条与中景，不强求逆光；雨雷或阵风明显时停止江边拍摄。 收工：核查四组各 3 张可用画面，标注入选与修图方向；复制到两处后再格式化存储卡，带走所有道具和垃圾。'
        Add-DemoText '图片来源：Jack No1（CC BY 3.0）、Vasily Astanin 与 Saigyouji-Noriko（CC BY-SA 4.0），Wikimedia Commons。模特三种姿态和道具为原创示意图，人物及拍摄安排均为虚构样例。'

        Start-Sleep -Seconds 1
    } elseif($Phase -eq 'reuse') {
        Chapter '复用素材：地点三张参考图，模特三种姿态' 'Reuse three location photos and three model pose references' 10
        Insert-Material '南京长江大桥' $false '02 场地与人物参考'
        Insert-Material '模特 A' $false '模特 A · 三种姿态'
        Insert-Material '透明伞' $false '03 道具与执行方法'
        Insert-Material '泡泡机' $false '03 道具与执行方法'
        Chapter '补充图片组，对照日间结构与蓝调光线' 'Add a gallery comparing daylight structure and blue-hour light' 4
        Insert-Material '桥畔光线参考' $true '04 光线参考'
        Start-Sleep -Seconds 2
    } elseif($Phase -eq 'layout') {
        Chapter '将泡泡机拖到透明伞右侧，同一行双栏展示' 'Drag the bubble-machine card beside the umbrella into two columns' 5
        New-DemoPropColumns
        Start-Sleep -Seconds 1
    } elseif($Phase -eq 'details') {
        Chapter '补充现场沟通，检查拍摄要点与现场清单' 'Add on-set direction and review the shooting checklist' 8
        $anchor='动作沟通：一次只给一个指令，先做静止、再转身、最后慢走。回看眼神、手指和衣摆，姿态自然后再加道具。'
        $guidance='现场沟通：先确认人物站位、光线方向和安全退路，再用样片说明视线与手势；每次只调整一个动作，试拍后让模特回看效果，确认舒适后再继续。'
        Focus-DemoDocumentText $anchor
        # This paragraph fits one visible line at the recorded 85% zoom.
        [DemoNative]::Key($script:DemoHandle,35)
        Start-Sleep -Milliseconds 300
        Send-DemoKeys '{ENTER}'
        [DemoNative]::Characters($script:DemoHandle,$guidance)
        Start-Sleep -Seconds 1
        $null=Show-DemoElement $guidance 'Text'
        $null=Show-DemoElement '05 拍照要点' 'Text'
        Start-Sleep -Seconds 2
        $null=Show-DemoElement '06 现场检查与交付' 'Text'
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
        Chapter '最后创建一个素材：名称、描述与关键词' 'Create a material with a name, description and tags' 3
        Click-Demo '素材库' 'Button'
        Set-DemoText '搜索素材名称、标签和全部文字' ''
        Click-Demo '创建素材' 'Button'
        Click-Demo '道具与服装' 'Button'
        Set-DemoText '素材名称' '透明伞 · 逆光拍摄'
        Set-DemoText '素材说明' '桥畔日落人像，透明伞保留光线与人物轮廓。'
        Set-DemoText '标签' '透明伞，逆光，南京，风光人像'
        Set-DemoText '道具与服装名称' '透明伞'
        Set-DemoText '道具与服装信息' '透明伞 · 一把 · 大风时收起'
        Chapter '添加样例图片，保存后可在其他项目复用' 'Add a sample image and save for your next project' 5
        Click-Demo '添加图片' 'Button'
        Select-DemoFile ((Resolve-Path 'docs/demo/photos/transparent-umbrella.png').Path)
        Start-Sleep -Seconds 1
        Save-DemoFrame $script:DemoHandle (Join-Path $workRoot 'new-material.png')
        Click-Demo '保存素材' 'Button'
        Wait-DemoGone '保存素材' 'Button'
        Click-Demo '选择素材：透明伞 · 逆光拍摄' 'Button'
        Click-Demo '预览' 'Button'
        $null=Show-DemoElement '选择素材图片 1' 'Button'
        Start-Sleep -Seconds 3
    }
} catch { $failure=$_.Exception.Message; Write-Output $failure }
finally {
    New-Item -ItemType File -Path (Join-Path $output 'stop') -Force | Out-Null
    if(-not $capture.WaitForExit(30000)){throw 'Recorder did not finish'}
    if($capture.ExitCode -ne 0){throw "Recorder failed: $($capture.ExitCode)"}
    $data=Get-Content -LiteralPath (Join-Path $output 'frames.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $timeline=@($chapters.ToArray() | ForEach-Object { @{seconds=($_.timestamp-$data.started)/1000;zh=$_.zh;en=$_.en;targetSeconds=$_.targetSeconds} })
    @{phase=$Phase;version=$demoVersion;chapters=$timeline;frames=$data.frames;duration=$data.duration;errors=@($(if($failure){$failure}))} | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $output 'recording.json')
    Save-DemoFrame $script:DemoHandle (Join-Path $output 'last.png')
}
if($failure){throw $failure}
