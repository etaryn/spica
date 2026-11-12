# Lays her rendered shots over their backgrounds and writes an MP4 for Ethan to watch: silent for an edit list, with the feed's sound for a scroll reel.
# A plain overlay on purpose: tint, rim light, grain and music are main's editing. Its recipe (fill, pan, offset, cuts, swipes) is what main copies.
# Args after --: <reel.json> <abs frames dir> <abs out.mp4> | scroll <abs reel dir> <abs frames dir> <abs out.mp4> [preview]. Run in an empty session: blender -b --factory-startup.
import json
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
import reel_edit as re_

FPS = 24
FPS_SLACK = 0.05  # the Sequencer plays a video frame for frame, so a 25 fps one runs 4% slow; anything further off fails (main retimes with ffmpeg)
VIDEO = {".mp4", ".webm", ".mov", ".mkv", ".avi"}
MANIFEST = Path(__file__).resolve().parent.parent / "clips.json"


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
    strips = setup(scene, W, H)
    t0 = 1
    for n, shot in enumerate(edit["shots"], 1):
        background(strips, n, shot, t0, W, H, root)
        her_strip(strips, "her-%02d" % n, Path(frames) / ("shot-%02d" % n), 2, t0, shot["frames"])
        t0 += shot["frames"]
    scene.frame_start, scene.frame_end = 1, t0 - 1
    return t0 - 1


def setup(scene, W, H):
    r = scene.render
    r.resolution_x, r.resolution_y, r.resolution_percentage, r.fps = W, H, 100, FPS
    scene.view_settings.view_transform = "Standard"  # the empty scene's default (AgX) would shift her colours
    return scene.sequence_editor_create().strips


def her_strip(strips, name, folder, channel, t0, frames):
    her = strips.new_image(name, str(folder / "0001.png"), channel, t0, fit_method="ORIGINAL")
    for k in range(2, frames + 1):
        her.elements.append("%04d.png" % k)
    her.blend_type = "ALPHA_OVER"


def has_sound(path):
    return bpy.data.sounds.load(str(path), check_existing=True).samplerate > 0  # a video with no sound track loads at rate 0


def check_feed(edit, root=re_.ROOT):
    """What only Blender can tell about the feed: each file is a video with sound that lasts its time on screen from its offset."""
    for k, (video, (t0, end)) in enumerate(zip(edit["feed"], re_.feed_spans(edit)), 1):
        path = re_.resolve(video["file"], root)
        w, h, fps, length = source_size(path)
        if fps is None:
            raise ValueError("feed video %d: %s is not a video" % (k, path.name))
        if not has_sound(path):
            raise ValueError("feed video %d: %s has no sound track" % (k, path.name))
        offset = video.get("offset", 0)
        need = offset + (end - t0) / FPS
        if need > length / fps + 1e-6:
            raise ValueError("feed video %d: %s is too short: it lasts %.2f s and the feed needs it to %.2f s" % (k, path.name, length / fps, need))


def feed_video(strips, name, path, channel, t0, end, offset, W, H):
    """A feed video on screen from t0 to end (exclusive), from offset seconds in, at its own speed, filling the frame."""
    w, h, fps, length = source_size(path)
    strip = strips.new_movie(name, str(path), channel, 1, fit_method="ORIGINAL")
    strip.retiming_keys.add(timeline_frame=1)
    strip.retiming_keys[-1].timeline_frame = 1 + round(length * FPS / fps)  # the Sequencer plays a video frame for frame; this stretches it to real time
    strip.frame_start = t0 - round(offset * FPS)
    strip.frame_final_start, strip.frame_final_end = t0, end
    strip.transform.scale_x = strip.transform.scale_y = max(W / w, H / h)
    strip.blend_type = "ALPHA_OVER"
    return strip


def feed_sound(strips, name, path, channel, t0, end, offset):
    sound = strips.new_sound(name, str(path), channel, 1)
    sound.frame_start = t0 - round(offset * FPS)
    sound.frame_final_start, sound.frame_final_end = t0, end


def slide(strip, at, H, leaving):
    """Over a swipe's scroll the feed moves up one screen, easing in and out: the old video from 0 to H, the next from -H to 0."""
    for f, y in zip((at, at + re_.SWIPE_FRAMES), (0, H) if leaving else (-H, 0)):
        strip.transform.offset_y = y
        strip.transform.keyframe_insert("offset_y", frame=f)


def build_scroll(scene, edit, frames, root=re_.ROOT):
    """A scroll reel in the Sequencer: the feed on channels 1..n (the next video above the one it pushes out), her on n + 1, each video's sound above her.
    Every strip has a channel of its own, since a strip made over another is moved aside by Blender. All the videos are retimed before any sound is added:
    in Blender 5.2 a sound strip made first hands its retiming keys to the next video's, and writing to them crashes."""
    re_.validate_scroll(edit, json.loads(MANIFEST.read_text())["faces"], root)
    check_feed(edit, root)
    W, H = edit["width"], edit["height"]
    strips = setup(scene, W, H)
    swipes, n = edit["swipes"], len(edit["feed"])
    videos = [(re_.resolve(v["file"], root), v.get("offset", 0)) for v in edit["feed"]]
    for k, ((path, offset), (t0, end)) in enumerate(zip(videos, re_.feed_spans(edit))):
        strip = feed_video(strips, "feed-%d" % (k + 1), path, 1 + k, t0, end, offset, W, H)
        if k > 0:
            slide(strip, swipes[k - 1], H, leaving=False)
        if k < len(swipes):
            slide(strip, swipes[k], H, leaving=True)
    for k, ((path, offset), (t0, heard)) in enumerate(zip(videos, re_.sound_spans(edit))):
        feed_sound(strips, "sound-%d" % (k + 1), path, n + 2 + k, t0, heard, offset)
    her_strip(strips, "her", Path(frames) / "shot-01", n + 1, 1, edit["frames"])
    scene.frame_start, scene.frame_end = 1, edit["frames"]


def still(scene, frame, path):
    scene.render.image_settings.file_format = "PNG"
    scene.frame_set(frame)
    scene.render.filepath = str(path)
    path.unlink(missing_ok=True)
    bpy.ops.render.render(write_still=True)


def write(scene, edit, out):
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    for old in out.parent.glob(out.stem + "-shot-*.png"):
        old.unlink()  # a longer earlier reel's stills would land on the sheet
    t0 = 1
    for n, shot in enumerate(edit["shots"], 1):
        still(scene, t0 + shot["frames"] // 2, out.parent / ("%s-shot-%02d.png" % (out.stem, n)))
        t0 += shot["frames"]
    write_video(scene, out, audio=False)


def write_video(scene, out, audio):
    """The scene's Sequencer as H.264, with its sound strips as AAC when audio is on."""
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    r = scene.render
    if hasattr(r.image_settings, "media_type"):
        r.image_settings.media_type = "VIDEO"
    r.image_settings.file_format = "FFMPEG"
    r.ffmpeg.format, r.ffmpeg.codec = "MPEG4", "H264"
    r.ffmpeg.constant_rate_factor = "HIGH"
    r.ffmpeg.audio_codec = "AAC" if audio else "NONE"
    if audio:
        r.ffmpeg.audio_channels, r.ffmpeg.audio_mixrate, r.ffmpeg.audio_bitrate = "STEREO", 48000, 192
    for old in out.parent.glob(out.stem + "_*.mp4"):
        old.unlink()
    r.filepath = str(out.parent / (out.stem + "_"))
    with bpy.context.temp_override(scene=scene):
        bpy.ops.render.render(animation=True, scene=scene.name)
    made = sorted(out.parent.glob(out.stem + "_*.mp4"))
    assert len(made) == 1, "expected one video, found %s" % made
    out.unlink(missing_ok=True)
    made[0].rename(out)  # Blender adds the frame range to a video's name


def main():
    args = sys.argv[sys.argv.index("--") + 1:]
    scene = bpy.context.scene
    if args[0] == "scroll":
        folder, frames, out = (Path(a) for a in args[1:4])
        edit = re_.load(folder / "reel.json")
        build_scroll(scene, re_.preview(edit) if args[4:] == ["preview"] else edit, frames)
        write_video(scene, out, audio=True)
    else:
        reel_json, frames, out = args
        build(scene, re_.load(reel_json), Path(frames))
        write(scene, re_.load(reel_json), Path(out))
    print("REEL", out)


if __name__ == "__main__":
    main()
