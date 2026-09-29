param([Parameter(Mandatory)][long]$WindowHandle,[string]$Work='.preshot-build-cache/installed-demo-final',[int]$Pages=3)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'demo-native-tools.ps1')
$workRoot=(Resolve-Path $Work).Path
$output=Join-Path $workRoot 'pdf'
if(Test-Path -LiteralPath (Join-Path $output 'recording.json')) { throw 'Archive the previous PDF take before recording again.' }
New-Item -ItemType Directory -Force $output | Out-Null
$script:DemoHandle=[IntPtr]$WindowHandle
[DemoNative]::ShowWindow($script:DemoHandle,9) | Out-Null
[DemoNative]::SetForegroundWindow($script:DemoHandle) | Out-Null
$address=Get-DemoElement 'Address and search bar' 'Edit'
$actual=($address.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).Current.Value
if($actual.Replace('/','\') -notlike ('*'+(Join-Path $workRoot 'nanjing-bridge.pdf')+'*')) { throw 'The reader must show the PDF exported by this isolated run.' }
$windowRect=New-Object DemoNative+RECT
[DemoNative]::GetWindowRect($script:DemoHandle,[ref]$windowRect) | Out-Null
$pageRect=(Get-DemoElement 'Page number' 'Edit').Current.BoundingRectangle
$top=[int]($pageRect.Top-$windowRect.Top-8)
$crop=@{x=16;y=$top;width=$windowRect.Right-$windowRect.Left-32;height=$windowRect.Bottom-$windowRect.Top-$top-16}
$clock=[System.Diagnostics.Stopwatch]::StartNew()
$frames=[System.Collections.Generic.List[object]]::new()
$chapters=[System.Collections.Generic.List[object]]::new()
$errors=[System.Collections.Generic.List[string]]::new()
try {
    for($number=1;$number -le $Pages;$number++) {
        $edit=Get-DemoElement 'Page number' 'Edit'
        $edit.SetFocus()
        ($edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).SetValue([string]$number)
        [DemoNative]::Key($script:DemoHandle,13)
        Start-Sleep -Seconds 1
        if(($edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)).Current.Value -ne [string]$number) { throw "Reader did not navigate to page $number" }
        $chapters.Add(@{seconds=$clock.Elapsed.TotalSeconds;zh="打开实际导出的 PDF · 第 $number / $Pages 页";en="Review the exported PDF · page $number of $Pages"})
        Save-DemoFrame $script:DemoHandle (Join-Path $workRoot "pdf-page-$number.png")
        for($n=0;$n -lt 24;$n++) {
            $name='{0:D6}.jpg' -f $frames.Count
            $seconds=$clock.Elapsed.TotalSeconds
            Save-DemoFrame $script:DemoHandle (Join-Path $output $name)
            $frames.Add(@{file=$name;seconds=$seconds})
            Start-Sleep -Milliseconds 200
        }
    }
} catch { $errors.Add($_.Exception.Message); throw }
finally {
    @{phase='pdf';frames=@($frames.ToArray());chapters=@($chapters.ToArray());duration=$clock.Elapsed.TotalSeconds;errors=@($errors.ToArray());crop=$crop} | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 (Join-Path $output 'recording.json')
    [DemoNative]::ShowWindow($script:DemoHandle,6) | Out-Null
}
