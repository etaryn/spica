/**
 * How this user texts, measured from their own recent messages: how long their texts run, whether
 * they write tidily, and whether they use emoji. A new user meets her base, and she drifts toward
 * their shape as they talk. Computed per reply from turns already loaded; nothing is stored.
 */
import type { VoiceConfig } from "@/mind/platform/config";

export type VoiceBand = VoiceConfig["bands"][number];
export type TextingShape = { band: VoiceBand; formal: boolean; emoji: boolean };

const EMOJI = /\p{Extended_Pictographic}/gu;

/** Words with at least one letter or digit; emoji and stray punctuation don't count. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The first band that fits `words`, moved `shift` bands (negative is shorter), kept in range. */
export function bandFor(words: number, bands: VoiceBand[], shift = 0): VoiceBand {
  const fits = bands.findIndex((b) => words <= b.max_words);
  const i = (fits === -1 ? bands.length - 1 : fits) + shift;
  return bands[Math.min(bands.length - 1, Math.max(0, i))]!;
}

/**
 * The median keeps one long rant from setting her length. Every measure is weighted by how full
 * the window is, so a single tidy "Hello." doesn't turn her formal.
 */
export function textingShape(messages: string[], cfg: VoiceConfig, bandShift = 0): TextingShape {
  const recent = messages.slice(-cfg.window_messages);
  const weight = Math.min(1, recent.length / cfg.window_messages);
  const counts = recent.map(wordCount).filter((n) => n > 0);
  const theirs = counts.length ? median(counts) : cfg.base_words_per_bubble;
  const words = cfg.base_words_per_bubble + (theirs - cfg.base_words_per_bubble) * weight;

  const share = (n: number) => (recent.length ? (n / recent.length) * weight : 0);
  // Only a closing full stop counts: phone keyboards capitalise the first letter for everyone.
  const tidy = recent.filter((m) => /[^.]\.$/.test(m.trim())).length;
  const emoji = recent.reduce((n, m) => n + (m.match(EMOJI)?.length ?? 0), 0);

  return {
    band: bandFor(words, cfg.bands, bandShift),
    formal: share(tidy) >= cfg.formal_threshold,
    emoji: share(emoji) >= cfg.emoji_rate,
  };
}
