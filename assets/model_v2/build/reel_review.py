# Lays her rendered shots over their backgrounds and writes a silent MP4 for Ethan to watch, plus one still per shot for a sheet.
# A plain overlay on purpose: tint, rim light, grain and music are main's editing. Its recipe (fill, pan, offset, cuts) is what main copies.
# Args after --: <reel.json> <absolute frames dir> <absolute out.mp4>. Run in an empty session: blender -b --factory-startup.
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
import reel_edit as re_

FPS = 24
FPS_SLACK = 0.05  # the Sequencer plays a video frame for frame, so a 25 fps one runs 4% slow; anything further off fails (main retimes with ffmpeg)
VIDEO = {".mp4", ".webm", ".mov", ".mkv", ".avi"}


def source_size(path):
    """Width, height and, for a video, fps and length in frames."""
    if path.suffix.lower() in VIDEO:
        clip = bpy.data.movieclips.load(str(path), check_existing=True)
        return clip.size[0], clip.size[1], clip.fps, clip.frame_duration
    image = bpy.data.images.load(str(path), check_existing=True)
    return image.size[0], image.size[1], None, None


def background(strips, n, shot, t0, W, H, root):
    bg = shot["background"]
    path = re_.resolve(bg["file"], root)
    w, h, fps, length = source_size(path)
    frames = shot["frames"]
    if fps is None:
        strip = strips.new_image("bg-%02d" % n, str(path), 1, t0, fit_method="ORIGINAL")
        strip.frame_final_duration = frames
    else:
        if abs(fps - FPS) > FPS * FPS_SLACK:
            re_.fail(n, "background video is %.2f fps; the review needs about %d (retiming is main's job)" % (fps, FPS))
        skip = round(bg.get("offset", 0) * FPS)
        if skip + frames > length:
            re_.fail(n, "background video has %d frames; the shot needs %d from frame %d" % (length, frames, skip))
        strip = strips.new_movie("bg-%02d" % n, str(path), 1, t0 - skip, fit_method="ORIGINAL")
        strip.frame_final_start, strip.frame_final_end = t0, t0 + frames
    s = max(W / w, H / h)  # fill the frame; the overflow is what pan moves through
    strip.transform.scale_x = strip.transform.scale_y = s
    over_x, over_y = w * s - W, h * s - H
    # ponytail: Blender's default easing on the keys, so a pan eases in and out; linear keys if Ethan wants a steady scroll
    for f, c in ((t0, bg["pan"][0]), (t0 + frames - 1, bg["pan"][1])):
        if over_x > 1:
            strip.transform.offset_x = (0.5 - c) * over_x  # pan 0 shows the left edge
            strip.transform.keyframe_insert("offset_x", frame=f)
        elif over_y > 1:
            strip.transform.offset_y = (c - 0.5) * over_y  # pan 0 shows the top edge
            strip.transform.keyframe_insert("offset_y", frame=f)


def build(scene, edit, frames, root=re_.ROOT):
    """The whole reel in the Sequencer: background on channel 1, her on channel 2, shots end to end. Returns its length."""
    re_.validate_backgrounds(edit, root)
    W, H = edit["width"], edit["height"]
    r = scene.render
    r.resolution_x, r.resolution_y, r.resolution_percentage, r.fps = W, H, 100, FPS
    scene.view_settings.view_transform = "Standard"  # the empty scene's default (AgX) would shift her colours
    strips = scene.sequence_editor_create().strips
    t0 = 1
    for n, shot in enumerate(edit["shots"], 1):
        background(strips, n, shot, t0, W, H, root)
        folder = Path(frames) / ("shot-%02d" % n)
        her = strips.new_image("her-%02d" % n, str(folder / "0001.png"), 2, t0, fit_method="ORIGINAL")
        for k in range(2, shot["frames"] + 1):
            her.elements.append("%04d.png" % k)
        her.blend_type = "ALPHA_OVER"
        t0 += shot["frames"]
    scene.frame_start, scene.frame_end = 1, t0 - 1
    return t0 - 1


def still(scene, frame, path):
    scene.render.image_settings.file_format = "PNG"
    scene.frame_set(frame)
    scene.render.filepath = str(path)
    path.unlink(missing_ok=True)
    bpy.ops.render.render(write_still=True)


def write(scene, edit, out):
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    t0 = 1
    for n, shot in enumerate(edit["shots"], 1):
        still(scene, t0 + shot["frames"] // 2, out.parent / ("%s-shot-%02d.png" % (out.stem, n)))
        t0 += shot["frames"]
    r = scene.render
    if hasattr(r.image_settings, "media_type"):
        r.image_settings.media_type = "VIDEO"
    r.image_settings.file_format = "FFMPEG"
    r.ffmpeg.format, r.ffmpeg.codec = "MPEG4", "H264"
    r.ffmpeg.constant_rate_factor, r.ffmpeg.audio_codec = "HIGH", "NONE"
    for old in out.parent.glob(out.stem + "_*.mp4"):
        old.unlink()
    r.filepath = str(out.parent / (out.stem + "_"))
    bpy.ops.render.render(animation=True)
    made = sorted(out.parent.glob(out.stem + "_*.mp4"))
    assert len(made) == 1, "expected one video, found %s" % made
    out.unlink(missing_ok=True)
    made[0].rename(out)  # Blender adds the frame range to a video's name


def main():
    reel_json, frames, out = sys.argv[sys.argv.index("--") + 1:]
    scene = bpy.context.scene
    build(scene, re_.load(reel_json), Path(frames))
    write(scene, re_.load(reel_json), Path(out))
    print("REEL", out)


if __name__ == "__main__":
    main()
