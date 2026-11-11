/**
 * What a reel needs from outside the mind: Blender renders her frames, ffmpeg fills and pans the
 * background and writes the MP4. Passed in like the web sources, so the mind never spawns a process
 * and tests can stand in for Blender.
 */
export type BackgroundOptions = {
  /** Seconds into a video where the shot starts; ignored for a still. */
  offset: number;
  frames: number;
  fps: number;
  width: number;
  height: number;
  /** Where the frame sits along the overflowing axis at the shot's first and last frame, 0 to 1. */
  pan: [number, number];
};

export type ReelTools = {
  /** The first renderer file that isn't there, or null: checked before anything is spent. */
  missing(): string | null;
  /** Her shots for an edit list file, as <outDir>/shot-NN/NNNN.png; throws with the renderer's last words. */
  renderShots(editListPath: string, outDir: string): Promise<void>;
  /** One shot's background: filled to the frame, panned (eased), as raw RGB frames of width×height. */
  background(file: string, opts: BackgroundOptions): AsyncIterable<Buffer>;
  /** Raw RGB frames to a silent H.264 MP4. */
  encode(
    frames: AsyncIterable<Buffer>,
    opts: { width: number; height: number; fps: number; crf: number; out: string },
  ): Promise<void>;
};

/** A find is a still or a video; a still is held for the whole shot. */
export const isStill = (file: string) => /\.(png|jpe?g|webp)$/i.test(file);
