/**
 * The reel's outside tools: Blender renders her frames with orbit's reel.py; ffmpeg fills and pans
 * the background and encodes the MP4. A failure carries the tool's last lines of stderr.
 * ponytail: Blender and the clips .blend are reached by configured paths into the orbit checkout;
 * ship them with the app before reels publish.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import type { Config } from "@/mind/platform/config";
import { isStill, type BackgroundOptions, type ReelTools } from "@/mind/platform/reel-tools";

const TAIL = 2000;

function ffmpeg(): string {
  if (!ffmpegStatic) throw new Error("ffmpeg-static has no binary for this platform");
  return ffmpegStatic;
}

/** Resolves when the tool exits cleanly; rejects naming it, with its stderr tail. */
function exitOf(proc: ChildProcess, exe: string): Promise<void> {
  let tail = "";
  proc.stderr!.on("data", (d: Buffer) => (tail = (tail + d.toString()).slice(-TAIL)));
  const exited = new Promise<void>((resolve, reject) => {
    proc.on("error", (e) => reject(new Error(`${exe}: ${e.message}`)));
    proc.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${path.basename(exe)} exited ${code}: ${tail.trim()}`)),
    );
  });
  exited.catch(() => {}); // awaited by the caller; this only stops an early failure going unhandled
  return exited;
}

async function run(exe: string, args: string[], stdin?: AsyncIterable<Buffer>): Promise<void> {
  const proc = spawn(exe, args, { stdio: [stdin ? "pipe" : "ignore", "ignore", "pipe"] });
  const exited = exitOf(proc, exe);
  if (stdin) {
    const pipe = proc.stdin!;
    pipe.on("error", () => {}); // a tool that dies early closes the pipe; its exit says why
    try {
      for await (const chunk of stdin) {
        if (pipe.destroyed) break;
        // Not events.once: it rejects on the pipe's EPIPE, which would hide the tool's own reason.
        if (!pipe.write(chunk))
          await Promise.race([new Promise((r) => pipe.once("drain", r)), exited]);
      }
    } catch (error) {
      proc.kill(); // the frames failed: stop the tool, and let it close its file before cleanup
      await exited.catch(() => {});
      throw error;
    }
    pipe.end();
  }
  await exited;
}

/** The pan as an ffmpeg expression, eased in and out like the review reel's keys; no commas. */
function panExpr(frames: number, [a, b]: [number, number]) {
  const s = `(n/${Math.max(frames - 1, 1)})`;
  return `(${a.toFixed(6)}+${(b - a).toFixed(6)}*${s}*${s}*(3-2*${s}))`;
}

async function* background(file: string, o: BackgroundOptions): AsyncIterable<Buffer> {
  const p = panExpr(o.frames, o.pan);
  const fill = `scale=${o.width}:${o.height}:force_original_aspect_ratio=increase`;
  const crop = `crop=${o.width}:${o.height}:(iw-ow)*${p}:(ih-oh)*${p}`;
  const still = isStill(file);
  const args = [
    ...["-v", "error"],
    ...(still
      ? ["-loop", "1", "-framerate", String(o.fps), "-i", file]
      : ["-ss", String(o.offset), "-i", file]),
    ...["-vf", still ? `${fill},${crop}` : `fps=${o.fps},${fill},${crop}`],
    ...["-frames:v", String(o.frames), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
  ];
  const exe = ffmpeg();
  const proc = spawn(exe, args, { stdio: ["ignore", "pipe", "pipe"] });
  const exited = exitOf(proc, exe);
  const size = o.width * o.height * 3;
  let got = 0;
  let pending: Buffer = Buffer.alloc(0);
  try {
    for await (const chunk of proc.stdout!) {
      pending = pending.length ? Buffer.concat([pending, chunk as Buffer]) : (chunk as Buffer);
      while (pending.length >= size) {
        got++;
        yield pending.subarray(0, size);
        pending = pending.subarray(size);
      }
    }
    await exited;
  } finally {
    proc.kill(); // a consumer that stopped early leaves no ffmpeg behind
  }
  if (got < o.frames) throw new Error(`background ${file} too short: ${got} of ${o.frames} frames`);
}

export function createReelTools(cfg: Config["posts"]["reel"]): ReelTools {
  return {
    missing: () =>
      [cfg.blender, cfg.script, cfg.blend].find((f) => !existsSync(path.resolve(f))) ?? null,
    renderShots: (editList, outDir) =>
      run(cfg.blender, [
        ...["-b", path.resolve(cfg.blend), "--python-exit-code", "1"],
        ...["-P", path.resolve(cfg.script), "--", path.resolve(editList), path.resolve(outDir)],
      ]),
    background,
    encode: (frames, o) =>
      run(
        ffmpeg(),
        [
          ...["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24"],
          ...["-s", `${o.width}x${o.height}`, "-r", String(o.fps), "-i", "-", "-an"],
          ...["-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", String(o.crf)],
          ...["-movflags", "+faststart", o.out],
        ],
        frames,
      ),
  };
}
