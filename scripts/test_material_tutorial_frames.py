"""Privacy and real FFmpeg concat checks (set PRESHOT_TEST_FFMPEG for encoding)."""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageChops

from material_tutorial_frames import STRICT_DECODE_OPTIONS, prepared_tutorial_frames


FFMPEG = os.environ.get("PRESHOT_TEST_FFMPEG") or shutil.which("ffmpeg")


class TutorialFrameTests(unittest.TestCase):
    def setUp(self):
        self.temp_root = Path(tempfile.gettempdir()).resolve()
        self.folder = Path(tempfile.mkdtemp(prefix="preshot-framing-test-")).resolve()

    def tearDown(self):
        self.assertEqual(self.folder.parent, self.temp_root)
        self.assertTrue(self.folder.name.startswith("preshot-framing-test-"))
        self.assertFalse(self.folder.is_symlink())
        shutil.rmtree(self.folder)

    def frame(self, name, surface=None, size=(1600, 1060)):
        image = Image.new("RGB", size, (40, 70, 90))
        image.paste((120, 40, 20), (0, 136, min(167, size[0]), min(1031, size[1])))
        image.paste((20, 180, 80), (220, 65, 1400, 120))
        image.save(self.folder / name)
        frame = {"file": name, "seconds": 0.25}
        if surface is not None:
            frame["surface"] = surface
        return frame

    def test_masks_only_navigation_and_preserves_application_and_original(self):
        app = self.frame("app.png", "application")
        external = self.frame("explorer.png", "external-window")
        original_bytes = (self.folder / external["file"]).read_bytes()
        with prepared_tutorial_frames(self.folder, "M05", [app, external]) as frames:
            self.assertEqual(frames[0]["surface"], "application")
            self.assertNotEqual(frames[0]["file"], app["file"])
            with Image.open(self.folder / frames[0]["file"]) as actual, Image.open(
                    self.folder / app["file"]) as raw:
                self.assertIsNone(ImageChops.difference(actual.convert("RGB"), raw.convert("RGB")).getbbox())
            self.assertEqual(frames[1]["seconds"], external["seconds"])
            self.assertNotEqual(frames[1]["file"], external["file"])
            prepared = self.folder / frames[1]["file"]
            self.assertTrue(prepared.resolve().is_relative_to(self.folder))
            with Image.open(prepared) as actual, Image.open(self.folder / external["file"]) as raw:
                expected = raw.convert("RGB")
                expected.paste("white", (0, 136, 167, 1031))
                self.assertIsNone(ImageChops.difference(actual.convert("RGB"), expected).getbbox())
            self.assertEqual((self.folder / external["file"]).read_bytes(), original_bytes)
        self.assertFalse(prepared.exists())
        self.assertEqual((self.folder / external["file"]).read_bytes(), original_bytes)

    def test_rejects_unexpected_external_dimensions(self):
        for size in [(1599, 1060), (1600, 1059)]:
            with self.subTest(size=size):
                frame = self.frame("unexpected.png", "external-window", size)
                with self.assertRaisesRegex(ValueError, "1600.*1060"):
                    with prepared_tutorial_frames(self.folder, "M05", [frame]):
                        self.fail("Unexpected dimensions reached the encoder")

    def test_m05_requires_tagged_external_windows(self):
        for frames in [[self.frame("legacy.png")], [self.frame("app.png", "application")]]:
            with self.subTest(frames=frames):
                with self.assertRaisesRegex(ValueError, "M05.*surface|M05.*external-window"):
                    with prepared_tutorial_frames(self.folder, "M05", frames):
                        self.fail("An unverified M05 take reached the encoder")

    def test_m05_rejects_partial_or_unknown_surface_metadata(self):
        external = self.frame("external.png", "external-window")
        for surface in [None, "unknown"]:
            with self.subTest(surface=surface):
                other = self.frame("other.png", surface)
                with self.assertRaisesRegex(ValueError, "surface"):
                    with prepared_tutorial_frames(self.folder, "M05", [external, other]):
                        self.fail("An unclassified M05 frame reached the encoder")

    def test_legacy_other_cases_remain_unchanged(self):
        frame = self.frame("legacy.png")
        with prepared_tutorial_frames(self.folder, "C01", [frame]) as prepared:
            self.assertEqual(prepared, [frame])

    def test_encoder_failure_cleans_only_disposable_copies(self):
        frame = self.frame("external.png", "external-window")
        original = (self.folder / frame["file"]).read_bytes()
        prepared = None
        with self.assertRaisesRegex(RuntimeError, "encoder failed"):
            with prepared_tutorial_frames(self.folder, "M05", [frame]) as frames:
                prepared = self.folder / frames[0]["file"]
                raise RuntimeError("encoder failed")
        self.assertIsNotNone(prepared)
        self.assertFalse(prepared.exists())
        self.assertEqual((self.folder / frame["file"]).read_bytes(), original)

    @unittest.skipUnless(FFMPEG, "Set PRESHOT_TEST_FFMPEG to run real encoder regressions")
    def test_real_ffmpeg_keeps_application_and_masked_external_frames_in_order(self):
        # Native capture writes JPEG. Masking Explorer must not change the
        # codec mid-concat: FFmpeg otherwise silently drops its PNG frames.
        originals = [self.frame("before.jpg", "application"),
                     self.frame("explorer.jpg", "external-window"),
                     self.frame("after.jpg", "application")]
        original_bytes = [(self.folder / frame["file"]).read_bytes() for frame in originals]
        with prepared_tutorial_frames(self.folder, "M05", originals) as frames:
            concat = "ffconcat version 1.0\n" + "".join(
                f"file '{frame['file']}'\nduration 1\n" for frame in frames)
            concat += f"file '{frames[-1]['file']}'\n"
            playlist = self.folder / "frames.txt"
            playlist.write_text(concat, encoding="utf-8")
            video = self.folder / "raw.mp4"
            encoded = subprocess.run([
                FFMPEG, "-hide_banner", "-loglevel", "error", "-nostdin",
                *STRICT_DECODE_OPTIONS, "-f", "concat", "-safe", "0",
                "-i", str(playlist), "-t", "3", "-vf", "scale=160:106", "-r", "24",
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "0",
                "-pix_fmt", "yuv420p", str(video)], capture_output=True)
            self.assertEqual(encoded.returncode, 0, encoded.stderr.decode(errors="replace"))
            decoded = subprocess.run([
                FFMPEG, "-hide_banner", "-loglevel", "error", "-nostdin",
                *STRICT_DECODE_OPTIONS, "-i", str(video),
                "-vf", "fps=1", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"],
                capture_output=True)
            self.assertEqual(decoded.returncode, 0, decoded.stderr.decode(errors="replace"))
            frame_size = 160 * 106 * 3
            self.assertEqual(len(decoded.stdout), frame_size * 3)
            for index in range(3):
                with Image.frombytes("RGB", (160, 106), decoded.stdout[
                        index * frame_size:(index + 1) * frame_size]) as picture:
                    pixel = picture.getpixel((8, 50))
                    expected = (255, 255, 255) if index == 1 else (120, 40, 20)
                    self.assertTrue(all(abs(actual - target) < 6
                                        for actual, target in zip(pixel, expected)),
                                    f"Frame {index} lost its surface/navigation: {pixel}")
        self.assertEqual([(self.folder / frame["file"]).read_bytes() for frame in originals],
                         original_bytes)

    @unittest.skipUnless(FFMPEG, "Set PRESHOT_TEST_FFMPEG to run real encoder regressions")
    def test_real_ffmpeg_fails_instead_of_silently_dropping_mixed_codec_frames(self):
        app = self.frame("app.jpg", "application")
        external = self.frame("external.png", "external-window")
        playlist = self.folder / "unprepared-frames.txt"
        playlist.write_text("ffconcat version 1.0\n" + "".join(
            f"file '{frame['file']}'\nduration 1\n" for frame in [app, external, app]),
            encoding="utf-8")
        result = subprocess.run([
            FFMPEG, "-hide_banner", "-loglevel", "error", "-nostdin",
            *STRICT_DECODE_OPTIONS, "-f", "concat", "-safe", "0", "-i", str(playlist),
            "-f", "null", "-"], capture_output=True)
        self.assertNotEqual(result.returncode, 0, "Malformed input must stop rendering")
        self.assertIn("decoder", result.stderr.decode(errors="replace"))


if __name__ == "__main__":
    unittest.main()
