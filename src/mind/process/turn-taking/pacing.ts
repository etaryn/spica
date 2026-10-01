import type { Clock } from "@/mind/platform/clock";
import type { TurnConfig } from "@/mind/platform/config";

/** FNV-1a → [0, 1). Deterministic jitter from an id, so evals and retries pace identically. */
export function seededUnit(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 2 ** 32;
}

/** How long to wait for more messages after this one, before any stretch. */
export function waitWindowMs(t: TurnConfig, complete: boolean, lastText: string): number {
  if (complete) return t.settle_ms;
  return t.wait_ms + (lastText.trim().length < t.short_message_chars ? t.short_wait_bonus_ms : 0);
}

/** Read delay, interpolated by how much there is to read, with ±15% jitter, clamped to [min, max]. */
export function readDelayMs(t: TurnConfig, bufferChars: number, unit: number): number {
  const frac = Math.min(1, bufferChars / t.read_delay_chars_for_max);
  const base = t.read_delay_min_ms + (t.read_delay_max_ms - t.read_delay_min_ms) * frac;
  const jittered = base * (0.85 + 0.3 * unit);
  return Math.round(Math.min(t.read_delay_max_ms, Math.max(t.read_delay_min_ms, jittered)));
}

export function typingMs(t: TurnConfig, chars: number): number {
  return Math.round(Math.min(t.typing_max_ms, chars * t.typing_ms_per_char));
}

export async function sleepUntil(clock: Clock, at: Date): Promise<void> {
  const ms = at.getTime() - clock.now().getTime();
  if (ms > 0) await clock.sleep(ms);
}
