/**
 * Pacing: how long she waits for more messages, how long she takes to read, and how long she
 * types, so replies arrive at a human pace instead of instantly.
 */
import type { Clock } from "@/mind/platform/clock";
import type { TurnConfig } from "@/mind/platform/config";

/** ±15% jitter around the base read delay. */
const JITTER_FLOOR = 0.85;
const JITTER_SPAN = 0.3;

/** How long to wait for more messages after this one, before any stretch. */
export function waitWindowMs(settings: TurnConfig, complete: boolean, lastText: string): number {
  if (complete) return settings.settle_ms;

  const isShort = lastText.trim().length < settings.short_message_chars;
  return settings.wait_ms + (isShort ? settings.short_wait_bonus_ms : 0);
}

/** Longer the more there is to read, jittered by `unit` (0–1), clamped to [min, max]. */
export function readDelayMs(settings: TurnConfig, bufferChars: number, unit: number): number {
  const { read_delay_min_ms: min, read_delay_max_ms: max } = settings;

  const fraction = Math.min(1, bufferChars / settings.read_delay_chars_for_max);
  const base = min + (max - min) * fraction;
  const jittered = base * (JITTER_FLOOR + JITTER_SPAN * unit);

  return Math.round(Math.min(max, Math.max(min, jittered)));
}

export function typingMs(settings: TurnConfig, chars: number): number {
  return Math.round(Math.min(settings.typing_max_ms, chars * settings.typing_ms_per_char));
}

export async function sleepUntil(clock: Clock, at: Date): Promise<void> {
  const ms = at.getTime() - clock.now().getTime();
  if (ms > 0) await clock.sleep(ms);
}
