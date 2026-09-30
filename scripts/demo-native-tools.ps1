# Shared Windows-only UI and capture helpers. No clipboard or application IPC.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Windows.Forms
if (-not ('DemoNative' -as [type])) {
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class DemoNative {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X,Y; }
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr z,int x,int y,int width,int height,uint flags);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
 [DllImport("user32.dll")] public static extern IntPtr GetLastActivePopup(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
 public delegate bool EnumChild(IntPtr h,IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h,EnumChild f,IntPtr l);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,System.Text.StringBuilder s,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern bool SetWindowText(IntPtr h,string text);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,EntryPoint="SendMessageW")] public static extern IntPtr SendText(IntPtr h,uint m,IntPtr w,string text);
 public static IntPtr ChildById(IntPtr root,int id) { IntPtr result=IntPtr.Zero;EnumChildWindows(root,(h,l)=>{if(GetDlgCtrlID(h)==id){result=h;return false;}return true;},IntPtr.Zero);return result; }
 public static IntPtr ChildByClass(IntPtr root,string name) { IntPtr result=IntPtr.Zero;EnumChildWindows(root,(h,l)=>{var s=new System.Text.StringBuilder(100);GetClassName(h,s,100);if(s.ToString()==name){result=h;return false;}return true;},IntPtr.Zero);return result; }
 public static IntPtr Renderer(IntPtr root) { IntPtr result=IntPtr.Zero; EnumChildWindows(root,(h,l)=>{var s=new System.Text.StringBuilder(100);GetClassName(h,s,100);if(s.ToString()=="Chrome_RenderWidgetHostHWND")result=h;return true;},IntPtr.Zero);if(result==IntPtr.Zero)throw new Exception("Renderer window unavailable");return result; }
 public static void Point(IntPtr root,uint message,int x,int y,bool down) { var target=Renderer(root);RECT r;GetWindowRect(target,out r);PostMessage(target,message,new IntPtr(down?1:0),new IntPtr(((y-r.Top)<<16)|((x-r.Left)&65535))); }
 public static void PostClick(IntPtr root,int x,int y) { Point(root,0x200,x,y,false);Point(root,0x201,x,y,true);Point(root,0x202,x,y,false); }
 public static void Characters(IntPtr root,string text) {var h=Renderer(root);foreach(char c in text)PostMessage(h,0x102,new IntPtr(c),IntPtr.Zero);}
 public static void Key(IntPtr root,int code) {var h=Renderer(root);PostMessage(h,0x100,new IntPtr(code),IntPtr.Zero);PostMessage(h,0x101,new IntPtr(code),IntPtr.Zero);}
 [StructLayout(LayoutKind.Explicit,Size=40)] public struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public ushort vk; [FieldOffset(10)] public ushort scan; [FieldOffset(12)] public uint flags; }
 [DllImport("user32.dll")] public static extern uint SendInput(uint n,INPUT[] input,int size);
 public static void TypeText(string text) { foreach(char c in text) { var a=new INPUT[2];a[0].type=a[1].type=1;a[0].scan=a[1].scan=c;a[0].flags=4;a[1].flags=6;SendInput(2,a,40); } }
 public static void Click(int x,int y) { SetCursorPos(x,y);mouse_event(2,0,0,0,UIntPtr.Zero);mouse_event(4,0,0,0,UIntPtr.Zero); }
 public static void Wheel(int delta) { mouse_event(0x800,0,0,unchecked((uint)delta),UIntPtr.Zero); }
}
'@
}
[DemoNative]::SetProcessDPIAware() | Out-Null

function Save-DemoFrame([IntPtr]$Handle,[string]$Path) {
    $r = New-Object DemoNative+RECT
    [DemoNative]::GetWindowRect($Handle,[ref]$r) | Out-Null
    $bitmap = New-Object System.Drawing.Bitmap ($r.Right-$r.Left),($r.Bottom-$r.Top)
    $g = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $captureApplication = {
            $dc = $g.GetHdc()
            try { if (-not [DemoNative]::PrintWindow($Handle,$dc,2)) { throw "PrintWindow failed for application window $Handle" } }
            finally { $g.ReleaseHdc($dc) }
        }
        & $captureApplication
        $popup = [DemoNative]::GetLastActivePopup($Handle)
        if ($popup -ne $Handle -and [DemoNative]::IsWindowVisible($popup)) {
            $p = New-Object DemoNative+RECT
            $hasBounds = [DemoNative]::GetWindowRect($popup,[ref]$p) -and $p.Right -gt $p.Left -and $p.Bottom -gt $p.Top
            if (-not $hasBounds) {
                if ([DemoNative]::GetLastActivePopup($Handle) -eq $popup -and [DemoNative]::IsWindowVisible($popup)) {
                    throw "Unable to read visible popup window bounds: $popup"
                }
                & $captureApplication
            } else {
                $overlay = New-Object System.Drawing.Bitmap ($p.Right-$p.Left),($p.Bottom-$p.Top)
                $pg = [System.Drawing.Graphics]::FromImage($overlay)
                try {
                    $pdc = $pg.GetHdc()
                    try { $popupCaptured = [DemoNative]::PrintWindow($popup,$pdc,2) } finally { $pg.ReleaseHdc($pdc) }
                    $after = New-Object DemoNative+RECT
                    $sameVisiblePopup = [DemoNative]::GetLastActivePopup($Handle) -eq $popup -and [DemoNative]::IsWindowVisible($popup)
                    $hasCurrentBounds = $sameVisiblePopup -and [DemoNative]::GetWindowRect($popup,[ref]$after)
                    if ($sameVisiblePopup -and -not $hasCurrentBounds) {
                        if ([DemoNative]::GetLastActivePopup($Handle) -eq $popup -and [DemoNative]::IsWindowVisible($popup)) {
                            throw "Unable to read visible popup window bounds after capture: $popup"
                        }
                        $sameVisiblePopup = $false
                    }
                    $sameBounds = $hasCurrentBounds -and
                        $after.Left -eq $p.Left -and $after.Top -eq $p.Top -and $after.Right -eq $p.Right -and $after.Bottom -eq $p.Bottom
                    if (-not $sameVisiblePopup -or -not $sameBounds) {
                        # A closing/moving picker invalidates this overlay. Refresh
                        # the real app frame rather than compositing stale/black pixels.
                        & $captureApplication
                    } elseif (-not $popupCaptured) {
                        throw "PrintWindow failed for visible popup window $popup"
                    } else {
                        $g.DrawImageUnscaled($overlay,$p.Left-$r.Left,$p.Top-$r.Top)
                    }
                } finally { $pg.Dispose(); $overlay.Dispose() }
            }
        }
        $cursor = New-Object DemoNative+POINT
        [DemoNative]::GetCursorPos([ref]$cursor) | Out-Null
        $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(110,198,56,94))
        try { $g.FillEllipse($brush,$cursor.X-$r.Left-9,$cursor.Y-$r.Top-9,18,18) } finally { $brush.Dispose() }
        if ($Path.EndsWith('.jpg')) { $bitmap.Save($Path,[System.Drawing.Imaging.ImageFormat]::Jpeg) }
        else { $bitmap.Save($Path,[System.Drawing.Imaging.ImageFormat]::Png) }
    } finally { $g.Dispose(); $bitmap.Dispose() }
}

function Get-DemoElement([string]$Name,[string]$Type='', [int]$Index=0) {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($script:DemoHandle)
    $dialogs=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,(New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Window)))
    if($dialogs.Count -gt 0) { $root=$dialogs[$dialogs.Count-1] }
    $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
    $matched = @($elements | Where-Object { ($_.Current.Name -eq $Name -or ($Name.EndsWith('*') -and $_.Current.Name -like $Name)) -and (-not $Type -or $_.Current.ControlType.ProgrammaticName -eq "ControlType.$Type") })
    if ($matched.Count -le $Index) { throw "UI element missing: $Type '$Name' index $Index" }
    return $matched[$Index]
}
function Wait-DemoGone([string]$Name,[string]$Type='') {
    for($n=0;$n -lt 40;$n++) { try { $null=Get-DemoElement $Name $Type } catch { return }; Start-Sleep -Milliseconds 250 }
    throw "UI did not close: $Name"
}
function Wait-DemoElement([string]$Name,[string]$Type='',[int]$Index=0) {
    for ($n=0;$n -lt 40;$n++) {
        try { return Get-DemoElement $Name $Type $Index } catch { Start-Sleep -Milliseconds 250 }
    }
    throw "Timed out waiting for $Type '$Name'"
}
function Click-Demo([string]$Name,[string]$Type='', [int]$Index=0) {
    $element = Wait-DemoElement $Name $Type $Index
    for($attempt=0; -not $element.Current.IsEnabled -and $attempt -lt 40; $attempt++) {
        Start-Sleep -Milliseconds 250
        $element = Wait-DemoElement $Name $Type $Index
    }
    if(-not $element.Current.IsEnabled){throw "UI element stayed disabled: $Name"}
    $scroll=$null
    if($element.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern,[ref]$scroll)) {
        $scroll.ScrollIntoView()
        Start-Sleep -Milliseconds 200
    }
    $rect = $element.Current.BoundingRectangle
    if ($rect.Width -le 0 -or $element.Current.IsOffscreen) {
        $pattern = $null
        if ($element.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern,[ref]$pattern)) { $pattern.ScrollIntoView(); Start-Sleep -Milliseconds 200; $rect=$element.Current.BoundingRectangle }
    }
    $invoke=$null
    if($Type -notin @('MenuItem','ListItem') -and $Name -notmatch '上传|添加图片|添加块|导出 PDF|导出 DOCX' -and $element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$invoke)) { $invoke.Invoke() }
    else { [DemoNative]::PostClick($script:DemoHandle,[int]($rect.X+$rect.Width/2),[int]($rect.Y+$rect.Height/2)) }
    Start-Sleep -Milliseconds 450
}
function Set-DemoText([string]$Name,[string]$Text) {
    $element = Wait-DemoElement $Name 'Edit'
    $element.SetFocus()
    ($element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue($Text)
    [DemoNative]::Key($script:DemoHandle,9)
    Start-Sleep -Milliseconds 300
}
function Send-DemoKeys([string]$Keys) {
    switch($Keys) {
        '{ENTER}' { [DemoNative]::Key($script:DemoHandle,13) }
        '{TAB}' { [DemoNative]::Key($script:DemoHandle,9) }
        '{ESC}' { [DemoNative]::Key($script:DemoHandle,27) }
        default { throw "Unsupported background UI key: $Keys" }
    }
    Start-Sleep -Milliseconds 250
}
function Set-DemoDocumentEnd {
    $element=Wait-DemoElement '' 'Edit'
    [void][DemoNative]::SetForegroundWindow($script:DemoHandle)
    $element.SetFocus()
    Start-Sleep -Milliseconds 200
    if([DemoNative]::GetForegroundWindow() -ne $script:DemoHandle){throw 'The owned Preshot window must be foreground before document navigation'}
    # WebView2 TextPattern ranges include nested card controls and can report
    # Select() success without moving the editable caret. Use the ordinary
    # keyboard shortcut in the focused editor, including an empty document.
    [System.Windows.Forms.SendKeys]::SendWait('^{END}')
    Start-Sleep -Milliseconds 400
}
function Add-DemoText([string]$Text,[string]$Prefix='') {
    Set-DemoDocumentEnd
    if ($Prefix) { [DemoNative]::Characters($script:DemoHandle,$Prefix); Start-Sleep -Milliseconds 250 }
    [DemoNative]::Characters($script:DemoHandle,$Text)
    Start-Sleep -Milliseconds 300
    Send-DemoKeys '{ENTER}'
}
function Add-DemoBlock([string]$Name) {
    Set-DemoDocumentEnd
    [DemoNative]::Characters($script:DemoHandle,'/')
    Start-Sleep -Milliseconds 600
    [DemoNative]::Characters($script:DemoHandle,$Name)
    Start-Sleep -Milliseconds 500
    Click-Demo ($Name+' *') 'ListItem'
}
function Show-DemoElement([string]$Name,[string]$Type='Text',[int]$Index=0) {
    $element=Wait-DemoElement $Name $Type $Index
    ($element.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern)).ScrollIntoView()
    Start-Sleep -Milliseconds 600
    return $element
}
function Move-DemoPointer([int]$X,[int]$Y) {
    [DemoNative]::Point($script:DemoHandle,0x200,$X,$Y,$false)
    Start-Sleep -Milliseconds 400
}
function Show-DemoDocumentTarget([string]$Name,[string]$Type='Text') {
    $element=Show-DemoElement $Name $Type
    $toolbar=(Get-DemoElement '导出' 'Button').Current.BoundingRectangle
    $window=New-Object DemoNative+RECT
    [DemoNative]::GetWindowRect($script:DemoHandle,[ref]$window)|Out-Null
    for($attempt=0;$attempt -lt 8;$attempt++) {
        $r=$element.Current.BoundingRectangle
        if($r.Top -ge $toolbar.Bottom+25 -and $r.Bottom -le $window.Bottom-40){return $element}
        # UIA does not account for the editor's sticky toolbar when scrolling.
        $delta=if($r.Top -lt $toolbar.Bottom+25){120}else{-120}
        $point=[IntPtr]((([int]($toolbar.Bottom+180)) -shl 16) -bor ([int]($r.X+30)))
        [DemoNative]::PostMessage([DemoNative]::Renderer($script:DemoHandle),0x020A,[IntPtr]($delta -shl 16),$point)|Out-Null
        Start-Sleep -Milliseconds 600
    }
    throw "Document target remains covered by the toolbar: $Name"
}
function Focus-DemoDocumentText([string]$Name) {
    # Focus first: focusing the editor after clicking can restore its old caret.
    (Get-DemoElement '' 'Edit').SetFocus()
    Start-Sleep -Milliseconds 300
    $r=(Show-DemoDocumentTarget $Name 'Text').Current.BoundingRectangle
    [DemoNative]::PostClick($script:DemoHandle,[int]($r.X+20),[int]($r.Y+10))
    Start-Sleep -Milliseconds 700
}
function Drag-DemoPointer([int]$X,[int]$Y,[int]$ToX,[int]$ToY) {
    [DemoNative]::Point($script:DemoHandle,0x200,$X,$Y,$false)
    [DemoNative]::Point($script:DemoHandle,0x201,$X,$Y,$true)
    for($n=1;$n -le 32;$n++) {
        [DemoNative]::Point($script:DemoHandle,0x200,[int]($X+($ToX-$X)*$n/32),[int]($Y+($ToY-$Y)*$n/32),$true)
        Start-Sleep -Milliseconds 35
    }
    Start-Sleep -Milliseconds 650
    [DemoNative]::Point($script:DemoHandle,0x202,$ToX,$ToY,$false)
    Start-Sleep -Milliseconds 900
}
function New-DemoColumns([string]$Source,[string]$Target) {
    $sourceRect=(Show-DemoElement $Source).Current.BoundingRectangle
    Move-DemoPointer ([int]($sourceRect.X+10)) ([int]($sourceRect.Y+8))
    $handle=(Get-DemoElement '打开菜单' 'Button').Current.BoundingRectangle
    $targetRect=(Get-DemoElement $Target 'Text').Current.BoundingRectangle
    $editor=(Get-DemoElement '' 'Edit').Current.BoundingRectangle
    Drag-DemoPointer ([int]($handle.X+$handle.Width/2)) ([int]($handle.Y+$handle.Height/2)) ([int]($editor.Right-3)) ([int]($targetRect.Y+10))
}
function Select-DemoFile([string]$Files) {
    # Native handles remain stable while opening the picker invalidates UIA.
    $popup=[IntPtr]::Zero
    for ($n=0;$n -lt 40;$n++) {
        $candidate=[DemoNative]::GetLastActivePopup($script:DemoHandle)
        $class=New-Object System.Text.StringBuilder 100
        [DemoNative]::GetClassName($candidate,$class,100)|Out-Null
        if($candidate -ne $script:DemoHandle -and $class.ToString() -eq '#32770' -and [DemoNative]::IsWindowVisible($candidate)) {
            $popup=$candidate
            break
        }
        Start-Sleep -Milliseconds 250
    }
    if ($popup -eq [IntPtr]::Zero) { throw 'Native file dialog missing' }
    $field=[DemoNative]::ChildById($popup,1148)
    if ($field -ne [IntPtr]::Zero) { $field=[DemoNative]::ChildByClass($field,'Edit') }
    if ($field -eq [IntPtr]::Zero) { $field=[DemoNative]::ChildById($popup,1152) }
    if ($field -eq [IntPtr]::Zero) {
        $dialog=[System.Windows.Automation.AutomationElement]::FromHandle($popup)
        $controls = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
        $nativeEdit=@($controls | Where-Object {$_.Current.ClassName -eq 'Edit' -and $_.Current.AutomationId -eq '1001'}) | Select-Object -First 1
        if ($null -ne $nativeEdit) { $field=[IntPtr]$nativeEdit.Current.NativeWindowHandle }
    }
    $confirm=[DemoNative]::ChildById($popup,1)
    if($field -eq [IntPtr]::Zero -or $confirm -eq [IntPtr]::Zero) { throw 'Native filename controls missing' }
    [DemoNative]::SendMessage($field,0xB1,[IntPtr]::Zero,[IntPtr](-1)) | Out-Null
    [DemoNative]::SendText($field,0xC2,[IntPtr]1,$Files) | Out-Null
    Start-Sleep -Milliseconds 600
    [DemoNative]::PostMessage($popup,0x0111,[IntPtr]1,$confirm)|Out-Null
    Start-Sleep -Milliseconds 1200
}
