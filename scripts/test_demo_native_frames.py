"""Exercise real frame composition through a file-only Win32 test boundary."""
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from PIL import Image


@unittest.skipUnless(shutil.which("powershell.exe"), "Windows PowerShell is required")
class PopupFrameTests(unittest.TestCase):
    def setUp(self):
        self.temp_root = Path(tempfile.gettempdir()).resolve()
        self.fixture = Path(tempfile.mkdtemp(prefix="preshot-popup-frame-test-")).resolve()
        shutil.copyfile(Path(__file__).with_name("demo-native-tools.ps1"),
                        self.fixture / "demo-native-tools.ps1")
        shutil.copyfile(Path(__file__).with_name("capture-demo-window.ps1"),
                        self.fixture / "capture-demo-window.ps1")
        (self.fixture / "run.ps1").write_text(r'''
param([string]$Mode,[switch]$Pipeline)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
public static class DemoNative {
 public struct RECT { public int Left,Top,Right,Bottom; }
 public struct POINT { public int X,Y; }
 public static string Mode;
 public static bool PopupAlive=true;
 public static bool PopupMoved=false;
 public static int AppCaptures=0, PopupCaptures=0;
 public static bool SetProcessDPIAware() { return true; }
 public static bool GetWindowRect(IntPtr h,out RECT r) {
   r=new RECT();
   if(h.ToInt64()==42){r.Right=64;r.Bottom=48;return true;}
   if(Mode=="visible-bounds-failure" && PopupCaptures>0)return false;
   r.Left=PopupMoved?14:10;r.Top=10;r.Right=34;r.Bottom=30;
   return PopupAlive;
 }
 public static IntPtr GetLastActivePopup(IntPtr h) { return new IntPtr(PopupAlive?84:42); }
 public static bool IsWindowVisible(IntPtr h) { return h.ToInt64()==42 || PopupAlive; }
 public static bool GetCursorPos(out POINT p) { p=new POINT();p.X=-100;p.Y=-100;return true; }
 public static bool PrintWindow(IntPtr h,IntPtr dc,uint flags) {
   if(h.ToInt64()==42) {
     AppCaptures++;
     if(Mode=="app-failure")return false;
     using(var g=Graphics.FromHdc(dc))g.Clear(AppCaptures==1?Color.FromArgb(20,40,60):Color.FromArgb(40,80,120));
     return true;
   }
   PopupCaptures++;
   if(Mode=="closed-failure" || Mode=="closed-success")PopupAlive=false;
   if(Mode=="moved-success")PopupMoved=true;
   if(Mode=="visible-failure" || Mode=="closed-failure")return false;
   using(var g=Graphics.FromHdc(dc))g.Clear(Color.FromArgb(240,160,20));
   return true;
 }
}
'@
[DemoNative]::Mode=$Mode
. (Join-Path $PSScriptRoot 'demo-native-tools.ps1')
$failure=$null
try {
    if($Pipeline) {
        function Get-Process {param([int]$Id) [pscustomobject]@{MainWindowHandle=[IntPtr]42}}
        $output=Join-Path $PSScriptRoot 'frames'
        $null=New-Item -ItemType Directory -Path $output
        & (Join-Path $PSScriptRoot 'capture-demo-window.ps1') -AppId 1 -Output $output
    } else { Save-DemoFrame ([IntPtr]42) (Join-Path $PSScriptRoot 'frame.png') }
}
catch { $failure=$_.Exception.Message }
@{failure=$failure;appCaptures=[DemoNative]::AppCaptures;popupCaptures=[DemoNative]::PopupCaptures} |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'result.json') -Encoding UTF8
if($failure){exit 1}
''', encoding="utf-8")

    def tearDown(self):
        self.assertEqual(self.fixture.parent, self.temp_root)
        self.assertTrue(self.fixture.name.startswith("preshot-popup-frame-test-"))
        self.assertFalse(self.fixture.is_symlink())
        self.assertFalse(self.fixture.is_junction())
        shutil.rmtree(self.fixture)

    def capture(self, mode, pipeline=False):
        process = subprocess.run(
            ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
             str(self.fixture / "run.ps1"), "-Mode", mode] + (["-Pipeline"] if pipeline else []),
            capture_output=True, text=True, timeout=15)
        result = json.loads((self.fixture / "result.json").read_text("utf-8-sig"))
        return process, result

    def test_stable_popup_is_composited(self):
        process, result = self.capture("stable")
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(result["appCaptures"], 1)
        with Image.open(self.fixture / "frame.png") as frame:
            self.assertEqual(frame.getpixel((12, 12))[:3], (240, 160, 20))
            self.assertEqual(frame.getpixel((2, 2))[:3], (20, 40, 60))

    def assert_fresh_app_after_popup_race(self, mode):
        process, result = self.capture(mode)
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertEqual(result["appCaptures"], 2)
        self.assertEqual(result["popupCaptures"], 1)
        with Image.open(self.fixture / "frame.png") as frame:
            self.assertEqual(frame.getpixel((12, 12))[:3], (40, 80, 120))
            self.assertEqual(frame.getpixel((2, 2))[:3], (40, 80, 120))

    def test_closed_popup_failed_capture_refreshes_application(self):
        self.assert_fresh_app_after_popup_race("closed-failure")

    def test_closed_popup_successful_capture_is_not_composited(self):
        self.assert_fresh_app_after_popup_race("closed-success")

    def test_moving_popup_refreshes_application_without_stale_composite(self):
        self.assert_fresh_app_after_popup_race("moved-success")

    def test_visible_popup_capture_failure_is_actionable(self):
        process, result = self.capture("visible-failure")
        self.assertNotEqual(process.returncode, 0)
        self.assertIn("popup", result["failure"].lower())
        self.assertIn("84", result["failure"])
        self.assertFalse((self.fixture / "frame.png").exists())

    def test_application_capture_failure_remains_failure(self):
        process, result = self.capture("app-failure")
        self.assertNotEqual(process.returncode, 0)
        self.assertIn("PrintWindow", result["failure"])
        self.assertFalse((self.fixture / "frame.png").exists())

    def test_still_visible_popup_bounds_failure_is_not_silently_hidden(self):
        process, result = self.capture("visible-bounds-failure")
        self.assertNotEqual(process.returncode, 0)
        self.assertIn("bounds", result["failure"].lower())
        self.assertIn("84", result["failure"])
        self.assertFalse((self.fixture / "frame.png").exists())

    def test_real_popup_failure_reaches_worker_diagnostics(self):
        process, result = self.capture("visible-failure", pipeline=True)
        self.assertNotEqual(process.returncode, 0)
        self.assertIn("popup", result["failure"].lower())
        output = self.fixture / "frames"
        data = json.loads((output / "frames.json").read_text("utf-8-sig"))
        error = json.loads((output / "capture-error.json").read_text("utf-8-sig"))
        self.assertFalse(data["completed"])
        self.assertEqual(data["frames"], [])
        self.assertIn("popup window 84", data["errors"][0])
        self.assertEqual(error["stage"], "capture")
        self.assertEqual(error["frame"], "000000.jpg")
        self.assertIn("popup window 84", error["message"])
        self.assertFalse((output / "000000.jpg").exists())


if __name__ == "__main__":
    unittest.main()
