"""Exercise the capture loop with a file-only native boundary, without desktop UI."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


@unittest.skipUnless(shutil.which("powershell"), "Windows PowerShell is required")
class CaptureMetadataTests(unittest.TestCase):
    def setUp(self):
        self.temp_root = Path(tempfile.gettempdir()).resolve()
        self.fixture = Path(tempfile.mkdtemp(prefix="preshot-capture-test-")).resolve()
        self.output = self.fixture / "frames"
        self.output.mkdir()
        self.script = self.fixture / "capture-demo-window.ps1"
        shutil.copyfile(Path(__file__).with_name("capture-demo-window.ps1"), self.script)
        (self.fixture / "demo-native-tools.ps1").write_text(r'''
function Get-Process { param([int]$Id) return [pscustomobject]@{MainWindowHandle=[IntPtr]42} }
function Test-Path {
    param([string]$LiteralPath)
    $exists=Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath
    if($exists -and $env:PRESHOT_CAPTURE_FIXTURE -eq 'marker-race' -and
            [IO.Path]::GetFileName($LiteralPath) -eq 'capture-handle.txt') {
        [IO.File]::Delete($LiteralPath)
    }
    return $exists
}
$script:fixtureFrames=0
function Save-DemoFrame {
    param([IntPtr]$Handle,[string]$Path)
    if($env:PRESHOT_CAPTURE_FIXTURE -eq 'capture-failure' -and $script:fixtureFrames -eq 1) {
        throw 'Synthetic PrintWindow failure'
    }
    [IO.File]::WriteAllBytes($Path,[byte[]](1,2,3))
    $script:fixtureFrames++
    if($env:PRESHOT_CAPTURE_FIXTURE -ne 'capture-failure') {
        [IO.File]::WriteAllText((Join-Path ([IO.Path]::GetDirectoryName($Path)) 'stop'),'')
    }
}
''', encoding="utf-8")

    def tearDown(self):
        self.assertEqual(self.fixture.parent, self.temp_root)
        self.assertTrue(self.fixture.name.startswith("preshot-capture-test-"))
        self.assertFalse(self.fixture.is_symlink())
        shutil.rmtree(self.fixture)

    def capture(self, mode, marker=None):
        if marker is not None:
            (self.output / "capture-handle.txt").write_text(marker, "utf-8")
        environment = dict(os.environ, PRESHOT_CAPTURE_FIXTURE=mode)
        return subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
             str(self.script), "-AppId", "1", "-Output", str(self.output)],
            capture_output=True, text=True, env=environment, timeout=15)

    def assert_success(self, process, surface):
        self.assertEqual(process.returncode, 0, process.stderr)
        data = json.loads((self.output / "frames.json").read_text("utf-8-sig"))
        self.assertEqual(len(data["frames"]), 1)
        self.assertEqual(data["frames"][0]["surface"], surface)

    def test_empty_marker_falls_back_to_application(self):
        self.assert_success(self.capture("empty", ""), "application")

    def test_marker_removed_after_existence_check_falls_back(self):
        self.assert_success(self.capture("marker-race", "84"), "application")

    def test_invalid_marker_falls_back_to_application(self):
        self.assert_success(self.capture("invalid", "not a window handle"), "application")

    def test_external_marker_remains_tagged(self):
        self.assert_success(self.capture("external", "84"), "external-window")

    def test_real_capture_failure_retains_partial_diagnostics_and_fails(self):
        result = self.capture("capture-failure")
        self.assertNotEqual(result.returncode, 0)
        data = json.loads((self.output / "frames.json").read_text("utf-8-sig"))
        self.assertFalse(data["completed"])
        self.assertEqual(len(data["frames"]), 1)
        self.assertEqual(data["frames"][0]["surface"], "application")
        self.assertIn("Synthetic PrintWindow failure", data["errors"][0])
        error = json.loads((self.output / "capture-error.json").read_text("utf-8-sig"))
        self.assertEqual(error["stage"], "capture")
        self.assertEqual(error["frame"], "000001.jpg")
        self.assertIn("Synthetic PrintWindow failure", error["message"])


if __name__ == "__main__":
    unittest.main()
