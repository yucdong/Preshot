param(
    [Parameter(Mandatory)][string]$Case,
    [string]$Work='.preshot-build-cache/material-tutorials-0.0.24'
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'demo-native-tools.ps1')
. (Join-Path $PSScriptRoot 'demo-native-session.ps1')
$session=Assert-DemoNativeSession $Work
$workRoot=$session.WorkRoot
$appId=$session.AppId
$demoVersion=$session.Version
$script:DemoHandle=$session.Handle
[DemoNative]::ShowWindow($script:DemoHandle,9) | Out-Null
$output=Assert-DemoOwnedPath (Join-Path $workRoot $Case) $session.CacheRoot $false
if(Test-Path -LiteralPath $output){throw "Archive the previous take before retrying: $output"}
New-Item -ItemType Directory $output | Out-Null
$chapters=[System.Collections.Generic.List[object]]::new()
$capture=Start-Process powershell -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'capture-demo-window.ps1'),'-AppId',$appId,'-Output',('"'+$output+'"')) -PassThru
function Chapter([string]$Zh,[string]$En,[double]$Seconds=6) {
    $chapters.Add(@{timestamp=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();zh=$Zh;en=$En;targetSeconds=$Seconds})
    Write-Output $Zh
}
function Open-Library {
    try {$null=Get-DemoElement '关闭素材库' 'Button'} catch {Click-Demo '素材库' 'Button'}
}
function Pick-Material([string]$Name) {
    Open-Library
    Set-DemoText '搜索素材名称、标签和全部文字' $Name
    Click-Demo ('选择素材：'+$Name) 'Button'
}
function Metadata([string]$Name,[string]$Description,[string]$Tags='南京，长江大桥，风光人像') {
    Set-DemoText '素材名称' $Name
    Set-DemoText '素材说明' $Description
    Set-DemoText '标签' $Tags
}
function Photos([string[]]$Names) {
    Click-Demo '添加图片' 'Button'
    $files=@($Names | ForEach-Object {'"'+(Resolve-Path ('docs/demo/photos/'+$_)).Path+'"'}) -join ' '
    Select-DemoFile $files
    Start-Sleep -Seconds 2
}
function Save-New([string]$Name) {
    Click-Demo '保存素材' 'Button'
    Wait-DemoGone '保存素材' 'Button'
    $null=Wait-DemoElement ('选择素材：'+$Name) 'Button'
    Start-Sleep -Seconds 1
}
function Save-DocumentMaterial([string]$Name) {
    Metadata $Name '从当前拍摄文档收纳，保留文字、图片与排版。'
    Click-Demo '保存素材' 'Button'
    Wait-DemoGone '保存素材' 'Button'
    Pick-Material $Name
    Start-Sleep -Seconds 2
}
function Fit-Material {
    for($step=0;$step -lt 2;$step++) {
        if((Get-DemoElement '缩小' 'Button').Current.IsEnabled){Click-Demo '缩小' 'Button'}
    }
    $null=Show-DemoElement '素材名称' 'Edit'
    Start-Sleep -Seconds 1
}
function Focus-VisibleParagraph([string]$Name) {
    $paragraph=Show-DemoDocumentTarget $Name 'Text'
    $rect=$paragraph.Current.BoundingRectangle
    if($paragraph.Current.IsOffscreen -or [double]::IsNaN($rect.X) -or $rect.Width -le 0){throw 'Paragraph must be visible before physical focus'}
    [void][DemoNative]::SetForegroundWindow($script:DemoHandle)
    if([DemoNative]::GetForegroundWindow() -ne $script:DemoHandle){throw 'Owned document must be foreground'}
    [DemoNative]::Click([int]($rect.X+20),[int]($rect.Y+$rect.Height/2))
    Start-Sleep -Milliseconds 700
}
function Show-OriginalFolder {
    $shell=New-Object -ComObject Shell.Application
    $libraryRoot=[IO.Path]::GetFullPath((Join-Path $workRoot 'profile\.preshot\library')).TrimEnd('\')
    $ownedWindows={
        foreach($candidate in $shell.Windows()) {
            try {
                $uri=[Uri]([string]$candidate.LocationURL)
                if(-not $uri.IsAbsoluteUri -or -not $uri.IsFile -or [IO.Path]::GetFileName([string]$candidate.FullName) -ine 'explorer.exe'){continue}
                $folder=[IO.Path]::GetFullPath($uri.LocalPath).TrimEnd('\')
                if($folder.Equals($libraryRoot,[StringComparison]::OrdinalIgnoreCase) -or $folder.StartsWith($libraryRoot+'\',[StringComparison]::OrdinalIgnoreCase)) {
                    [pscustomobject]@{Window=$candidate;Folder=$folder}
                }
            } catch { }
        }
    }
    # Each reveal gets a fresh owned Explorer window. Otherwise a minimized
    # earlier gallery window could be recorded for the single-image action.
    # Only this isolated profile's library windows are closed; no files change.
    foreach($owned in @(& $ownedWindows)) {$owned.Window.Quit()}
    for($attempt=0;$attempt -lt 40 -and @(& $ownedWindows).Count;$attempt++) {Start-Sleep -Milliseconds 250}
    if(@(& $ownedWindows).Count){throw 'The previous isolated library folder did not close'}
    Click-Demo '打开原图所在位置' 'Button'
    $window=$null
    $openedFolder=$null
    for($attempt=0;$attempt -lt 40;$attempt++) {
        $opened=@(& $ownedWindows)
        if($opened.Count -gt 1){throw 'Multiple isolated library windows opened; cannot identify the revealed folder'}
        if($opened.Count -eq 1){$window=$opened[0].Window;$openedFolder=$opened[0].Folder}
        if($window){break}
        Start-Sleep -Milliseconds 250
    }
    if(-not $window){throw 'The isolated library originals folder did not open'}
    $openedFolder | Add-Content -LiteralPath (Join-Path $output 'revealed-folders.txt') -Encoding UTF8
    $folderHandle=[IntPtr]([long]$window.HWND)
    [DemoNative]::ShowWindow($folderHandle,9) | Out-Null
    [DemoNative]::SetWindowPos($folderHandle,[IntPtr]::Zero,30,30,1600,1060,0x0040) | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $output 'capture-handle.txt'),[string]$folderHandle.ToInt64())
    Start-Sleep -Seconds 3
    Save-DemoFrame $folderHandle (Join-Path $output ('originals-'+[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+'.png'))
    Remove-Item -LiteralPath (Join-Path $output 'capture-handle.txt')
    [DemoNative]::ShowWindow($folderHandle,6) | Out-Null
    [DemoNative]::ShowWindow($script:DemoHandle,9) | Out-Null
}
$failure=$null
try {
    Start-Sleep -Seconds 2
    if($Case -in @('C01','C02','C03','C04','C05')) {
        $config=switch($Case) {
            'C01' { @{Category='图片';Name='桥畔蓝调 · 单图';Description='南京长江大桥蓝调时刻，参考灯光与纵深。';Photos=@('bridge-night.jpg');Fields=@{}} }
            'C02' { @{Category='图片组';Name='桥畔光线 · 图片组';Description='日间与蓝调对照，选取同一地点的不同光线。';Photos=@('bridge-day.jpg','bridge-night.jpg');Fields=@{}} }
            'C03' { @{Category='场地';Name='南京长江大桥 · 地点';Description='江边公共步道，日落与蓝调人像拍摄地点。';Photos=@('bridge-day.jpg','bridge-night.jpg','bridge-panorama.jpg');Fields=[ordered]@{'场地名称'='南京长江大桥';'场地信息'='从允许停留的江边步道拍摄；留意风向与行人。'}} }
            'C04' { @{Category='模特';Name='模特 A · 人像';Description='虚构模特，用于南京长江大桥风光人像方案。';Photos=@('model-a.png','model-a-walking.png','model-a-umbrella.png');Fields=[ordered]@{'模特名称 / 编号'='模特 A（虚构）';'身高 cm'='168';'鞋码'='38';'其他信息'='浅色服装，侧身回望，缓慢行走。样片为原创示意图。'}} }
            'C05' { @{Category='道具与服装';Name='透明伞 · 道具';Description='日落逆光道具，透明材质保留人物轮廓。';Photos=@('transparent-umbrella.png');Fields=[ordered]@{'道具与服装名称'='透明伞';'道具与服装信息'='自备一把透明伞；江边大风时收起。'}} }
        }
        Chapter ('新建'+$config.Category+'素材') ('Create a '+(@{C01='single image';C02='gallery';C03='location';C04='model';C05='prop'}[$Case])+' material') 5
        Open-Library
        Click-Demo '创建素材' 'Button'
        Click-Demo $config.Category 'Button'
        Chapter '填写素材名称、说明和检索标签' 'Add a name, description and searchable tags' 8
        Metadata $config.Name $config.Description
        if($config.Fields.Count) {
            Chapter '补充组件内容，插入文档后可继续修改' 'Complete the card details for reuse in your document' 7
            foreach($key in $config.Fields.Keys) {Set-DemoText $key $config.Fields[$key]}
        }
        Chapter '添加样例图片，查看导入后的实际效果' 'Import sample pictures and inspect the result' 8
        Photos $config.Photos
        Fit-Material
        Save-DemoFrame $script:DemoHandle (Join-Path $output 'draft.png')
        Chapter '保存后自动返回素材库，素材可跨项目复用' 'Save and return to the library, ready for another project' 6
        Save-New $config.Name
        Save-DemoFrame $script:DemoHandle (Join-Path $output 'saved.png')
    } elseif($Case -eq 'C15') {
        Chapter '关闭当前项目，回到项目启动页面' 'Return to the launcher by closing the current project' 6
        Open-Library
        Click-Demo '关闭素材库' 'Button'
        Click-Demo '关闭项目 南京长江大桥 · 演示项目' 'Button'
        Click-Demo '保存并关闭' 'Button'
        Chapter '没有打开项目，也可以创建素材' 'Create library materials without an open project' 7
        Open-Library
        Click-Demo '创建素材' 'Button'
        Click-Demo '道具与服装' 'Button'
        Metadata '泡泡机 · 前景道具' '顺风侧放置泡泡机，营造轻盈的人像前景。' '泡泡机，南京，前景'
        Set-DemoText '道具与服装名称' '泡泡机'
        Set-DemoText '道具与服装信息' '携带备用泡泡液；避免地面湿滑。'
        Chapter '添加图片后保存，今后可插入任意项目' 'Add its picture and save for use in future projects' 9
        Photos @('bubble-machine.png')
        Save-New '泡泡机 · 前景道具'
    } elseif($Case -eq 'M01') {
        Chapter '按名称查找已保存的素材' 'Search saved materials by name' 6
        Pick-Material '桥畔蓝调 · 单图'
        Chapter '标签和素材说明同样支持检索' 'Search by tags and description as well' 7
        Set-DemoText '搜索素材名称、标签和全部文字' '风光人像'
        Start-Sleep -Seconds 2
        Set-DemoText '搜索素材名称、标签和全部文字' '纵深'
        $null=Wait-DemoElement '选择素材：桥畔蓝调 · 单图' 'Button'
        Chapter '切换分类，快速定位图片、模特和道具' 'Filter images, models and props by category' 7
        Set-DemoText '搜索素材名称、标签和全部文字' ''
        Click-Demo '图片组' 'Button'
        $null=Wait-DemoElement '选择素材：桥畔光线 · 图片组' 'Button'
        Click-Demo '模特' 'Button'
        $null=Wait-DemoElement '选择素材：模特 A · 人像' 'Button'
        Chapter '支持最近更新、相关度和名称排序' 'Sort by recent updates, relevance or name' 6
        Click-Demo '全部素材' 'Button'
        (Get-DemoElement '排序方式' 'ComboBox').SetFocus()
        [DemoNative]::Key($script:DemoHandle,35)
        Send-DemoKeys '{ENTER}'
        Start-Sleep -Seconds 2
    } elseif($Case -eq 'M02') {
        Chapter '选中素材，点击收藏' 'Select a material and add it to favorites' 6
        Pick-Material '桥畔蓝调 · 单图'
        Click-Demo '收藏' 'Button' 1
        $null=Wait-DemoElement '取消收藏' 'Button'
        Chapter '收藏分类集中显示常用素材' 'Find frequently used materials in Favorites' 7
        Set-DemoText '搜索素材名称、标签和全部文字' ''
        Click-Demo '收藏' 'Button'
        Click-Demo '选择素材：桥畔蓝调 · 单图' 'Button'
        Start-Sleep -Seconds 2
        Chapter '取消收藏，素材仍保留在全部素材中' 'Unfavorite an item without deleting it' 7
        Click-Demo '取消收藏' 'Button'
        Click-Demo '全部素材' 'Button'
        Pick-Material '桥畔蓝调 · 单图'
    } elseif($Case -eq 'M03') {
        Chapter '编辑素材，名称和说明可随时更新' 'Edit a material name and description' 7
        Pick-Material '透明伞 · 道具'
        Click-Demo '编辑素材' 'Button'
        Metadata '透明伞 · 逆光道具' '透明伞适合逆光与江风人像，日落前准备。' '透明伞，逆光，南京'
        Chapter '修改内容后保存，编辑框保持打开' 'Save the card changes and continue editing' 7
        Set-DemoText '道具与服装信息' '自备透明伞与擦拭布；风大时收起。'
        Click-Demo '保存素材' 'Button'
        $null=Wait-DemoElement '素材已保存，可继续编辑；关闭后更新预览。' 'Text'
        Chapter '关闭未保存修改时，可选择继续或放弃' 'Keep editing or discard changes made after your last save' 7
        Set-DemoText '素材说明' '这段临时修改将被放弃。'
        Click-Demo '关闭' 'Button'
        Click-Demo '继续编辑' 'Button'
        Click-Demo '关闭' 'Button'
        Click-Demo '放弃修改' 'Button'
        Chapter '已保存的内容仍然保留，项目中的副本不受影响' 'Saved changes remain; inserted project copies stay independent' 5
        Pick-Material '透明伞 · 逆光道具'
        Start-Sleep -Seconds 2
    } elseif($Case -in @('C06','C07','C08')) {
        $card=switch($Case){
            'C06' {@{Kind='场地';Material='南京长江大桥 · 地点';Title='南京长江大桥';Saved='文档收纳 · 场地'}}
            'C07' {@{Kind='模特';Material='模特 A · 人像';Title='模特 A（虚构）';Saved='文档收纳 · 模特'}}
            'C08' {@{Kind='道具';Material='透明伞 · 道具';Title='透明伞';Saved='文档收纳 · 道具'}}
        }
        Chapter ('将'+$card.Kind+'卡片插入当前文档') ('Insert the '+(@{C06='location';C07='model';C08='prop'}[$Case])+' card into your document') 6
        Pick-Material $card.Material
        Click-Demo '插入到当前文档' 'Button'
        Wait-DemoGone '关闭素材库' 'Button'
        Chapter '打开卡片右上角的更多操作' 'Open the card menu in its top-right corner' 6
        $null=Show-DemoElement ($card.Title+'更多操作') 'Button'
        Click-Demo ($card.Title+'更多操作') 'Button'
        Click-Demo '保存到素材库' 'MenuItem'
        Chapter '填写收纳名称、说明和标签，保存独立副本' 'Name and tag the snapshot, then save an independent copy' 10
        Save-DocumentMaterial $card.Saved
    } elseif($Case -eq 'C09') {
        Chapter '将图片组放入文档，完整保留图片顺序' 'Insert the complete gallery into the document' 6
        Pick-Material '桥畔光线 · 图片组'
        Click-Demo '插入到当前文档' 'Button'
        Click-Demo '确认插入' 'Button'
        Wait-DemoGone '确认插入' 'Button'
        Wait-DemoGone '关闭素材库' 'Button'
        Chapter '从图片组工具栏将整组收纳入素材库' 'Save the entire group from its toolbar' 6
        $null=Show-DemoElement '保存图片组到素材库' 'Button'
        Click-Demo '保存图片组到素材库' 'Button'
        Chapter '设置素材信息，组内所有原图一起保存' 'Save metadata and independent copies of all group pictures' 10
        Save-DocumentMaterial '文档收纳 · 图片组'
    } elseif($Case -eq 'C10') {
        Chapter '单击选中图片组里的一张图片' 'Select one picture inside a document gallery' 6
        Open-Library
        Click-Demo '关闭素材库' 'Button'
        $null=Show-DemoElement '选择参考图 1' 'Button'
        Click-Demo '选择参考图 1' 'Button'
        Chapter '将选中的图片保存为单张图片素材' 'Save the selected picture as an image material' 6
        Click-Demo '添加到素材库' 'Button'
        Chapter '单图拥有独立的名称、说明和检索标签' 'Give the individual image its own name, description and tags' 10
        Save-DocumentMaterial '文档收纳 · 单张桥景'
    } elseif($Case -eq 'C14') {
        Chapter '创建图片组，不必重新选择磁盘上的原图' 'Create a gallery using pictures already in your library' 6
        Open-Library
        Click-Demo '创建素材' 'Button'
        Click-Demo '图片组' 'Button'
        Metadata '桥畔混合参考 · 素材复用' '从已有图片组和单张图片选取，形成新的独立素材。'
        Chapter '从图片组素材里选择需要的照片' 'Choose individual photos from an existing gallery material' 8
        Click-Demo '从素材库插入' 'Button'
        Set-DemoText '搜索素材名称、标签和全部文字' '桥畔光线 · 图片组'
        Click-Demo '选择素材：桥畔光线 · 图片组' 'Button'
        Click-Demo '插入到当前图片组' 'Button'
        Click-Demo '选择第 2 张图片' 'CheckBox'
        Click-Demo '确认插入' 'Button'
        Chapter '也可以追加单张图片素材' 'Append a single-image material to the same gallery' 8
        Click-Demo '从素材库插入' 'Button'
        Set-DemoText '搜索素材名称、标签和全部文字' '桥畔蓝调 · 单图'
        Click-Demo '选择素材：桥畔蓝调 · 单图' 'Button'
        Click-Demo '插入到当前图片组' 'Button'
        Chapter '保存为新的素材，来源素材保持独立' 'Save a new material with its own copies of the originals' 6
        Fit-Material
        Save-New '桥畔混合参考 · 素材复用'
    } elseif($Case -eq 'I03') {
        Chapter '整组插入，保留全部图片和顺序' 'Insert the whole gallery in its original order' 7
        Pick-Material '桥畔光线 · 图片组'
        Click-Demo '插入到当前文档' 'Button'
        Click-Demo '确认插入' 'Button'
        Wait-DemoGone '确认插入' 'Button'
        Wait-DemoGone '关闭素材库' 'Button'
        Chapter '只选择需要的图片，插入一个新图片组' 'Choose a subset and insert it as a new gallery' 9
        Pick-Material '桥畔光线 · 图片组'
        Click-Demo '插入到当前文档' 'Button'
        Click-Demo '取消全选' 'Button'
        if((Get-DemoElement '确认插入' 'Button').Current.IsEnabled){throw 'Empty selection must disable insertion'}
        Click-Demo '选择第 1 张图片' 'CheckBox'
        Click-Demo '确认插入' 'Button'
        Wait-DemoGone '确认插入' 'Button'
        Wait-DemoGone '关闭素材库' 'Button'
        Chapter '切换为独立图片，每张照片生成一个图片块' 'Choose independent images to create separate image blocks' 9
        Pick-Material '桥畔光线 · 图片组'
        Click-Demo '插入到当前文档' 'Button'
        Click-Demo '独立图片' 'RadioButton'
        Click-Demo '确认插入' 'Button'
        Wait-DemoGone '确认插入' 'Button'
        Wait-DemoGone '关闭素材库' 'Button'
        Start-Sleep -Seconds 2
    } elseif($Case -eq 'I04') {
        Chapter '打开当前图片组的从素材库插入按钮' 'Open the library from the current gallery toolbar' 6
        Open-Library
        Click-Demo '关闭素材库' 'Button'
        $null=Show-DemoElement '从素材库插入' 'Button'
        Click-Demo '从素材库插入' 'Button'
        Chapter '选择图片组里的部分照片追加' 'Append selected photos from a gallery material' 8
        Set-DemoText '搜索素材名称、标签和全部文字' '桥畔光线 · 图片组'
        Click-Demo '选择素材：桥畔光线 · 图片组' 'Button'
        Click-Demo '插入到当前图片组' 'Button'
        Click-Demo '选择第 1 张图片' 'CheckBox'
        Click-Demo '确认插入' 'Button'
        Wait-DemoGone '关闭素材库' 'Button'
        Chapter '也可直接插入单图，已有图片继续保留' 'Append a single image while keeping existing pictures' 8
        Click-Demo '从素材库插入' 'Button'
        Set-DemoText '搜索素材名称、标签和全部文字' '桥畔蓝调 · 单图'
        Click-Demo '选择素材：桥畔蓝调 · 单图' 'Button'
        Click-Demo '插入到当前图片组' 'Button'
        Wait-DemoGone '关闭素材库' 'Button'
        Start-Sleep -Seconds 2
    } elseif($Case -eq 'M04') {
        Chapter '选择素材只看详情，点击预览才打开完整内容' 'Select an item for details; click Preview to open its content' 6
        Pick-Material '桥畔光线 · 图片组'
        Start-Sleep -Seconds 2
        Click-Demo '预览' 'Button'
        $null=Wait-DemoElement '选择素材图片 1' 'Button'
        Chapter '查看完整图片组，点选图片进行检查' 'Inspect the full gallery and select a picture' 7
        Click-Demo '选择素材图片 1' 'Button'
        Start-Sleep -Seconds 2
        Chapter '预览为只读，关闭后继续管理或插入素材' 'Preview is read-only; close it to manage or insert the material' 5
        Click-Demo '关闭完整组件预览' 'Button'
    } elseif($Case -eq 'M05') {
        Chapter '图片组详情可直接打开整组原图目录' 'Open a gallery original folder directly from its details' 8
        Pick-Material '桥畔光线 · 图片组'
        Show-OriginalFolder
        Chapter '完整预览中也能打开原图目录' 'The full preview provides the same original-folder action' 8
        Click-Demo '预览' 'Button'
        Show-OriginalFolder
        Click-Demo '关闭完整组件预览' 'Button'
        Chapter '编辑时定位已保存的原图，原文件独立保留' 'Locate saved originals while editing the material' 8
        Click-Demo '编辑素材' 'Button'
        Show-OriginalFolder
        Click-Demo '取消' 'Button'
        Chapter '单张图片无需先选择，直接定位到原图' 'Locate a single-image original without selecting its picture first' 8
        Pick-Material '桥畔蓝调 · 单图'
        Show-OriginalFolder
    } elseif($Case -eq 'M06') {
        Chapter '删除前确认，取消不会移除素材' 'Cancel a deletion to keep the material unchanged' 6
        Pick-Material '桥畔蓝调 · 单图'
        Click-Demo '删除' 'Button'
        Click-Demo '取消' 'Button'
        Chapter '确认删除后，素材进入回收站' 'Confirm deletion to move a material to the recycle bin' 7
        Click-Demo '删除' 'Button'
        Click-Demo '确认删除' 'Button'
        Click-Demo '回收站' 'Button'
        Set-DemoText '搜索素材名称、标签和全部文字' ''
        Click-Demo '选择素材：桥畔蓝调 · 单图' 'Button'
        Chapter '恢复素材，重新回到全部素材列表' 'Restore the material and return to the active library' 7
        Click-Demo '恢复素材' 'Button'
        Click-Demo '全部素材' 'Button'
        Pick-Material '桥畔蓝调 · 单图'
    } elseif($Case -eq 'M07') {
        Chapter '先移入回收站；项目里已经插入的副本不受影响' 'Move a saved snapshot to the bin; project copies stay independent' 7
        Pick-Material '文档收纳 · 道具'
        Click-Demo '删除' 'Button'
        Click-Demo '确认删除' 'Button'
        Click-Demo '回收站' 'Button'
        Click-Demo '选择素材：文档收纳 · 道具' 'Button'
        Chapter '永久删除需要再次确认，也可以取消' 'Permanent deletion requires confirmation and can be cancelled' 7
        Click-Demo '永久删除' 'Button'
        Click-Demo '取消' 'Button'
        Chapter '确认后仅删除这份素材，操作不可恢复' 'Confirm to permanently delete this material only' 7
        Click-Demo '永久删除' 'Button'
        Click-Demo '确认永久删除' 'Button'
        Wait-DemoGone '确认永久删除' 'Button'
        $null=Wait-DemoElement '回收站为空' 'Text'
        Chapter '返回项目，透明伞卡片及其图片仍然完整' 'Return to the document: its umbrella card and picture remain' 6
        Click-Demo '全部素材' 'Button'
        Click-Demo '关闭素材库' 'Button'
        $null=Show-DemoElement '透明伞更多操作' 'Button'
        Save-DemoFrame $script:DemoHandle (Join-Path $output 'project-copy-retained.png')
    } elseif($Case -eq 'M08') {
        Chapter '编辑图片组，点选图片查看八方向缩放区域' 'Edit a gallery and select a picture to resize its frame' 7
        Pick-Material '桥畔混合参考 · 素材复用'
        Click-Demo '编辑素材' 'Button'
        Click-Demo '选择参考图 1' 'Button'
        $edge=Get-DemoElement '从right调整参考图 1' 'Thumb'
        $rect=$edge.Current.BoundingRectangle
        Drag-DemoPointer ([int]($rect.X+$rect.Width/2)) ([int]($rect.Y+$rect.Height/2)) ([int]($rect.X+$rect.Width/2+75)) ([int]($rect.Y+$rect.Height/2))
        Click-Demo '撤销' 'Button'
        Click-Demo '重做' 'Button'
        Chapter '切换自由变形，再恢复裁切填满' 'Switch to stretch, or use crop-to-fill for the frame' 7
        Click-Demo '切换参考图 1 为自由变形' 'Button'
        Click-Demo '撤销' 'Button'
        $null=Wait-DemoElement '切换参考图 1 为自由变形' 'Button'
        Click-Demo '重做' 'Button'
        $null=Wait-DemoElement '切换参考图 1 为裁切适配' 'Button'
        Click-Demo '切换参考图 1 为裁切适配' 'Button'
        Chapter '双击打开只读大图，裁切适配保留在画布中' 'Open the read-only image preview; crop-to-fill stays in the canvas' 10
        Click-Demo '选择参考图 1' 'Button'
        Send-DemoKeys '{ENTER}'
        $null=Wait-DemoElement '关闭图片' 'Button'
        $previewRoot=[System.Windows.Automation.AutomationElement]::FromHandle($script:DemoHandle)
        $cropControls=@($previewRoot.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition) | Where-Object {
            $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.Name -in @('裁剪','确认裁剪')
        })
        if($cropControls.Count){throw 'Enlarged image preview unexpectedly offers cropping'}
        Save-DemoFrame $script:DemoHandle (Join-Path $output 'read-only-preview.png')
        Start-Sleep -Seconds 2
        Click-Demo '关闭图片' 'Button'
        Chapter '保存后关闭，预览使用已提交的图片与排版' 'Save and close; preview the committed pictures and layout' 8
        Click-Demo '保存素材' 'Button'
        $null=Wait-DemoElement '素材已保存，可继续编辑；关闭后更新预览。' 'Text'
        Click-Demo '关闭' 'Button'
        Click-Demo '预览' 'Button'
        Start-Sleep -Seconds 2
        Click-Demo '关闭完整组件预览' 'Button'
    } elseif($Case -eq 'M09') {
        Chapter '编辑图片组，拖动图片改变顺序' 'Edit a gallery and drag pictures to reorder them' 8
        Pick-Material '桥畔混合参考 · 素材复用'
        Click-Demo '编辑素材' 'Button'
        $first=(Show-DemoElement '选择参考图 1' 'Button').Current.BoundingRectangle
        $second=(Get-DemoElement '选择参考图 2' 'Button').Current.BoundingRectangle
        Drag-DemoPointer ([int]($first.X+$first.Width/2)) ([int]($first.Y+$first.Height/2)) ([int]($second.Right-12)) ([int]($second.Y+$second.Height/2))
        if(-not (Get-DemoElement '撤销' 'Button').Current.IsEnabled){throw 'Image reorder did not produce an undoable edit'}
        Chapter '删除选中的图片，确认后从当前草稿移除' 'Remove a selected picture after confirmation' 7
        Click-Demo '选择参考图 2' 'Button'
        Click-Demo '删除选中图片' 'Button'
        Click-Demo '删除' 'Button'
        Wait-DemoGone '选择参考图 2' 'Button'
        Chapter '撤销和重做可恢复图片，保存前都能继续调整' 'Undo and redo restore pictures while you continue editing' 8
        Click-Demo '撤销' 'Button'
        $null=Wait-DemoElement '选择参考图 2' 'Button'
        Click-Demo '重做' 'Button'
        Wait-DemoGone '选择参考图 2' 'Button'
        Click-Demo '撤销' 'Button'
        # Restored images must become selectable immediately; a stale source
        # readiness cache previously left this button permanently disabled.
        Click-Demo '选择参考图 2' 'Button'
        $null=Wait-DemoElement '从right调整参考图 2' 'Thumb'
        Save-DemoFrame $script:DemoHandle (Join-Path $output 'restored-image-ready.png')
        Chapter '保存排序结果，关闭后更新素材预览' 'Save the reordered gallery and refresh its preview' 6
        Click-Demo '保存素材' 'Button'
        $null=Wait-DemoElement '素材已保存，可继续编辑；关闭后更新预览。' 'Text'
        Click-Demo '关闭' 'Button'
        $null=Wait-DemoElement '桥畔混合参考 · 素材复用的组件缩略图' 'Image'
        $null=Wait-DemoElement '预览' 'Button'
        Start-Sleep -Seconds 3
    } elseif($Case -eq 'C17') {
        Chapter '新建素材时，已有名称会提示再次确认' 'Creating a material with an existing name asks for confirmation' 8
        Open-Library
        Click-Demo '创建素材' 'Button'
        Click-Demo '道具与服装' 'Button'
        Metadata '泡泡机 · 前景道具' '同名素材示例，取消后改用更明确的名称。'
        Set-DemoText '道具与服装名称' '备用泡泡机'
        Photos @('bubble-machine.png')
        Click-Demo '保存素材' 'Button'
        $null=Wait-DemoElement '仍然保存' 'Button'
        Chapter '取消同名保存，返回草稿修改名称' 'Cancel the duplicate-name confirmation and rename the draft' 7
        Click-Demo '取消' 'Button'
        Set-DemoText '素材名称' '泡泡机 · 备用设备'
        Chapter '新草稿可随时放弃，不会修改已有素材' 'Discard the draft without changing an existing material' 7
        Click-Demo '取消' 'Button'
        Click-Demo '放弃修改' 'Button'
        Pick-Material '泡泡机 · 前景道具'
    } elseif($Case -eq 'I01') {
        Chapter '先定位文档光标，再打开顶部素材库' 'Place the document cursor, then open the header library' 7
        Open-Library
        Click-Demo '关闭素材库' 'Button'
        Add-DemoText '现场道具安排'
        Pick-Material '泡泡机 · 前景道具'
        Chapter '插入完整卡片，文字与原图保存为项目副本' 'Insert the card with independent project text and image copies' 7
        Click-Demo '插入到当前文档' 'Button'
        Wait-DemoGone '关闭素材库' 'Button'
        $null=Show-DemoElement '泡泡机更多操作' 'Button'
        Chapter '项目中可以调整信息，素材库保留原始内容' 'Customize project details without changing the library original' 8
        $root=[System.Windows.Automation.AutomationElement]::FromHandle($script:DemoHandle)
        $field=@($root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition) | Where-Object {
            $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and
            $_.Current.Name -eq '道具信息' -and
            ($_.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).Current.Value -like '*备用泡泡液*'
        }) | Select-Object -First 1
        if(-not $field){throw 'Inserted bubble-machine description missing'}
        ($field.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern)).ScrollIntoView()
        $field.SetFocus()
        ($field.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue('本次拍摄：17:30 放在顺风侧，准备两瓶备用泡泡液。')
        Send-DemoKeys '{TAB}'
        Pick-Material '泡泡机 · 前景道具'
        Click-Demo '预览' 'Button'
        Start-Sleep -Seconds 2
        Click-Demo '关闭完整组件预览' 'Button'
    } elseif($Case -eq 'I02') {
        Chapter '在文档中输入斜杠，从素材库插入' 'Type slash in the document to insert from the library' 7
        Open-Library
        Click-Demo '关闭素材库' 'Button'
        Focus-VisibleParagraph '桥畔构图参考'
        [void][DemoNative]::SetForegroundWindow($script:DemoHandle)
        [System.Windows.Forms.SendKeys]::SendWait('{END}{ENTER}')
        [DemoNative]::TypeText('/')
        Start-Sleep -Milliseconds 600
        [DemoNative]::TypeText('从素材库插入')
        Click-Demo '从素材库插入 *' 'ListItem'
        Set-DemoText '搜索素材名称、标签和全部文字' '桥畔蓝调 · 单图'
        Click-Demo '选择素材：桥畔蓝调 · 单图' 'Button'
        Click-Demo '插入到当前文档' 'Button'
        Wait-DemoGone '关闭素材库' 'Button'
        Chapter '也可以点击段落左侧加号，打开插入菜单' 'Use the plus beside a paragraph to open the insert menu' 8
        # Native-image insertion can leave a node selection. Use an existing
        # visible paragraph; UIA SetFocus on the editor is not a text caret.
        Focus-VisibleParagraph '桥畔构图参考'
        $r=(Show-DemoDocumentTarget '桥畔构图参考' 'Text').Current.BoundingRectangle
        if([double]::IsNaN($r.X) -or [double]::IsNaN($r.Y) -or $r.Width -le 0){throw 'The visible paragraph must have finite bounds before hovering its plus button'}
        [void][DemoNative]::SetCursorPos([int]($r.X+15),[int]($r.Y+8))
        Start-Sleep -Milliseconds 700
        $plus=Wait-DemoElement '添加块' 'Button'
        $plusRect=$plus.Current.BoundingRectangle
        if($plus.Current.IsOffscreen -or [double]::IsNaN($plusRect.X) -or $plusRect.Width -le 0){throw 'Paragraph plus must be visible before physical click'}
        [DemoNative]::Click([int]($plusRect.X+$plusRect.Width/2),[int]($plusRect.Y+$plusRect.Height/2))
        $null=Wait-DemoElement '从素材库插入 *' 'ListItem'
        Save-DemoFrame $script:DemoHandle (Join-Path $output 'bottom-menu.png')
        Chapter '菜单随可用空间展开，选取素材后插入当前位置' 'Choose a material from the menu at the current document position' 8
        Click-Demo '从素材库插入 *' 'ListItem'
        Set-DemoText '搜索素材名称、标签和全部文字' '模特 A · 人像'
        Click-Demo '选择素材：模特 A · 人像' 'Button'
        Click-Demo '插入到当前文档' 'Button'
        Wait-DemoGone '关闭素材库' 'Button'
    } elseif($Case -eq 'C19') {
        Chapter '导入带相机旋转信息的 JPEG' 'Import a JPEG with camera orientation metadata' 7
        Open-Library
        Click-Demo '创建素材' 'Button'
        Click-Demo '图片' 'Button'
        Metadata '大桥相机原图 · 方向保留' '照片按相机方向显示，原图字节独立保留。' '南京，长江大桥，相机，原图'
        Click-Demo '添加图片' 'Button'
        Select-DemoFile (Join-Path $workRoot 'fixtures\bridge-camera-rotation.jpg')
        $null=Wait-DemoElement '选择参考图 1' 'Button'
        Chapter '画布与大图预览保持正确方向' 'The canvas and enlarged preview preserve the intended orientation' 9
        Click-Demo '选择参考图 1' 'Button'
        Send-DemoKeys '{ENTER}'
        $null=Wait-DemoElement '关闭图片' 'Button'
        Save-DemoFrame $script:DemoHandle (Join-Path $output 'camera-preview.png')
        Start-Sleep -Seconds 2
        Click-Demo '关闭图片' 'Button'
        Chapter '保存为图片素材，插入文档后仍保持方向' 'Save an image material and reuse it in the document' 9
        Save-New '大桥相机原图 · 方向保留'
        Pick-Material '大桥相机原图 · 方向保留'
        Click-Demo '插入到当前文档' 'Button'
        Wait-DemoGone '关闭素材库' 'Button'
        $cameraManifest=Join-Path $workRoot 'profile\.preshot\projects\南京长江大桥 · 演示项目\.preshotproj'
        $cameraSaved=$false
        for($attempt=0;$attempt -lt 40;$attempt++) {
            $cameraPlan=(Get-Content -LiteralPath $cameraManifest -Raw -Encoding UTF8 | ConvertFrom-Json).plan
            if($cameraPlan.schemaVersion -eq 18 -and ($cameraPlan | ConvertTo-Json -Depth 40) -match '"presentationAxes"\s*:\s*"exif"') {$cameraSaved=$true;break}
            Start-Sleep -Milliseconds 250
        }
        if(-not $cameraSaved){throw 'The inserted camera image did not persist its EXIF presentation'}
        Start-Sleep -Seconds 2
        Save-DemoFrame $script:DemoHandle (Join-Path $output 'camera-inserted.png')
    } elseif($Case -eq 'C12') {
        Chapter '在正文中插入一个独立图片块' 'Insert an independent image block in the document' 7
        Open-Library
        Click-Demo '关闭素材库' 'Button'
        Add-DemoText '桥畔构图参考'
        Add-DemoBlock '图片'
        Chapter '选择上传，从磁盘导入原始图片' 'Choose Upload and select an original picture from disk' 8
        Click-Demo '上传图片' 'Button'
        Select-DemoFile ((Resolve-Path 'docs/demo/photos/bridge-day.jpg').Path)
        $null=Wait-DemoElement 'bridge-day.jpg' 'Image'
        Chapter '图片显示在正文中，项目保留独立的本地副本' 'The image appears in the document as a project-local copy' 6
        $null=Show-DemoElement 'bridge-day.jpg' 'Image'
        Start-Sleep -Seconds 2
    } elseif($Case -eq 'C11') {
        Chapter '单击选中正文里的独立图片' 'Select an independent image in your document' 6
        Click-Demo 'bridge-day.jpg' 'Image'
        Chapter '点击添加到素材库，打开素材信息弹框' 'Click Add to material library to open the metadata dialog' 6
        Click-Demo '添加到素材库' 'Button'
        Chapter '保存图片素材，原项目和素材各自保留独立图片' 'Save an image material with an original independent of the project' 10
        Save-DocumentMaterial '独立图片收纳 · 大桥白昼'
    } elseif($Case -eq 'C16') {
        Chapter '每张参考图的快捷按钮也可以单独收纳图片' 'Use a picture tile shortcut to save an individual image' 7
        Open-Library
        Click-Demo '关闭素材库' 'Button'
        Click-Demo '选择参考图 1' 'Button'
        Click-Demo '保存参考图 1 到素材库' 'Button'
        Chapter '设置独立素材名称和标签，保存即可跨项目复用' 'Add metadata and save for reuse across projects' 10
        Save-DocumentMaterial '快捷收纳 · 桥畔参考'
    } else {throw "Tutorial case not implemented: $Case"}
    Start-Sleep -Seconds 2
    $root=[System.Windows.Automation.AutomationElement]::FromHandle($script:DemoHandle)
    $visibleErrors=@($root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and $_.Current.Name -match '无法完成|操作失败|导入失败|保存失败' })
    if($visibleErrors.Count){throw ('Visible UI failure: '+$visibleErrors[0].Current.Name)}
} catch {$failure=$_.Exception.Message;Write-Output $failure}
finally {
    New-Item -ItemType File -Path (Join-Path $output 'stop') -Force | Out-Null
    if(-not $capture.WaitForExit(30000)){throw 'Recorder did not finish'}
    if($capture.ExitCode -ne 0){throw "Recorder failed: $($capture.ExitCode)"}
    $data=Get-Content (Join-Path $output 'frames.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $timeline=@($chapters.ToArray()|ForEach-Object {@{seconds=($_.timestamp-$data.started)/1000;zh=$_.zh;en=$_.en;targetSeconds=$_.targetSeconds}})
    @{phase=$Case;version=$demoVersion;chapters=$timeline;frames=$data.frames;duration=$data.duration;errors=@($(if($failure){$failure}));crop=@{x=10;y=51;width=1580;height=998}} | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $output 'recording.json')
    Save-DemoFrame $script:DemoHandle (Join-Path $output 'last.png')
}
if($failure){throw $failure}
