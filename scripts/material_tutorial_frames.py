"""Prepare disposable presentation frames without changing recorded originals."""
from contextlib import contextmanager
from pathlib import Path
import shutil
import tempfile

from PIL import Image


STRICT_DECODE_OPTIONS = ("-xerror", "-err_detect", "explode")


@contextmanager
def prepared_tutorial_frames(folder, case, frames):
    """Use uniform PNG copies when masking Explorer; keep raw frames intact."""
    folder = Path(folder).resolve(strict=True)
    surfaces = [frame.get("surface") for frame in frames]
    if any(surface not in (None, "application", "external-window") for surface in surfaces):
        raise ValueError(f"Unknown capture surface in {case}")
    if case == "M05":
        if any(surface is None for surface in surfaces):
            raise ValueError("M05 needs surface metadata on every frame; record the take again")
        if "external-window" not in surfaces:
            raise ValueError("M05 needs tagged external-window frames; record the take again")
    if "external-window" not in surfaces:
        yield frames
        return

    staging = Path(tempfile.mkdtemp(prefix=".masked-external-", dir=folder)).resolve()
    try:
        prepared = []
        for index, frame in enumerate(frames):
            source = (folder / frame["file"]).resolve(strict=True)
            if not source.is_relative_to(folder):
                raise ValueError(f"Frame leaves its recording directory: {case}")
            with Image.open(source) as image:
                external = frame.get("surface") == "external-window"
                if external and image.size != (1600, 1060):
                    raise ValueError(f"External-window frames require 1600 x 1060 pixels: {case} frame {index}")
                presentation = image.convert("RGB")
                if external:
                    # Inclusive raw Explorer navigation bounds. Preserve its
                    # address bar and originals pane; do not mask application UI.
                    presentation.paste("white", (0, 136, 167, 1031))
                # FFmpeg concat fixes the decoder from the first image. Every
                # frame must share PNG encoding, including unmasked app JPEGs.
                # These derived copies preserve decoded pixels without JPEG loss.
                output = staging / f"{index:06}.png"
                presentation.save(output)
            prepared.append({**frame, "file": output.relative_to(folder).as_posix()})
        yield prepared
    finally:
        # Only this operation's owned, direct child may be recursively removed.
        if (staging.parent != folder or not staging.name.startswith(".masked-external-")
                or staging.is_symlink() or staging.is_junction() or staging.resolve() != staging):
            raise RuntimeError("Refusing cleanup outside the owned masked-frame directory")
        shutil.rmtree(staging)
