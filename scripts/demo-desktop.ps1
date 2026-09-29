param(
    [ValidateSet('position', 'dialog', 'shot', 'minimize')][string]$Action,
    [int]$AppId,
    [string]$Value = '',
    [string]$Output = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Windows.Forms
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DemoWindow {
 [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr z,int x,int y,int w,int height,uint flags);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int n);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
}
'@
[DemoWindow]::SetProcessDPIAware() | Out-Null
$process = Get-Process -Id $AppId
$window = $process.MainWindowHandle
if ($Action -eq 'minimize') { [DemoWindow]::ShowWindow($window,6) | Out-Null; exit }
if ($Action -eq 'position') {
    [DemoWindow]::ShowWindow($window,9) | Out-Null
    [DemoWindow]::SetWindowPos($window,[IntPtr]::Zero,30,30,1600,1060,0x0040) | Out-Null
    [DemoWindow]::SetForegroundWindow($window) | Out-Null
    exit
}
if ($Action -eq 'dialog') {
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $AppId)
    $dialog = $null
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,$condition)
        foreach ($candidate in $windows) {
            if ($candidate.Current.ClassName -eq '#32770') { $dialog = $candidate; break }
        }
        if ($null -ne $dialog) { break }
        Start-Sleep -Milliseconds 200
    }
    if ($null -eq $dialog) { throw 'No native file dialog belonging to the installed test application appeared.' }
    $controls = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
    $edit = $null; $submit = $null
    foreach ($control in $controls) {
        if ($control.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and $control.Current.AutomationId -eq '1148') { $edit = $control }
        if ($control.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $control.Current.AutomationId -eq '1') { $submit = $control }
    }
    if ($null -eq $edit -or $null -eq $submit) {
        $names = @($controls | ForEach-Object { "$($_.Current.ControlType.ProgrammaticName):$($_.Current.AutomationId):$($_.Current.Name)" }) -join ', '
        throw "Unable to locate the native filename field and confirmation button: $names"
    }
    $pattern = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $pattern.SetValue($Value)
    Start-Sleep -Milliseconds 500
    ($submit.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
    exit
}
if ($Action -eq 'shot') {
    $rect = New-Object DemoWindow+RECT
    [DemoWindow]::GetWindowRect($window,[ref]$rect) | Out-Null
    $bitmap = New-Object System.Drawing.Bitmap ($rect.Right-$rect.Left),($rect.Bottom-$rect.Top)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $dc = $graphics.GetHdc()
        try { if (-not [DemoWindow]::PrintWindow($window,$dc,2)) { throw 'Installed window capture failed' } }
        finally { $graphics.ReleaseHdc($dc) }
        $bitmap.Save($Output,[System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
