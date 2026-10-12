/**
 * Her words for a post. The draft sees her public self, the find, how much it moved her and the
 * format, never what she privately thought of it: a post is written fresh, the way a person's post
 * differs from their diary. The check reads the finished words for anything that shouldn't be public.
 */
import { z } from "zod";
import type { CoreDeps } from "@/mind/platform/deps";
import { loadPrompt } from "@/mind/platform/prompts";
import type { WebFindRow } from "@/mind/world/types";
import type { StillFormat } from "./post-library";
import type { PublicPersona } from "./public-persona";

export type Draft = { caption: string; overlay_text: string | null };
type Find = Pick<WebFindRow, "title" | "source" | "credit">;
export type DraftInput = {
  persona: PublicPersona;
  find: Find;
  valence: number;
  format: StillFormat;
  skill: number;
};

const DraftSchema = z.object({ caption: z.string(), overlay_text: z.string().nullable() });
const CheckSchema = z.object({ ok: z.boolean(), reason: z.string() });

const tidy = (s: string, max: number) => s.trim().replace(/\s+/g, " ").slice(0, max).trim();

/** Null when the model wrote no caption. Model failures throw; the core loop runner traces them. */
export async function draftPost(
  deps: Pick<CoreDeps, "llm" | "config">,
  input: DraftInput,
): Promise<Draft | null> {
  const { config } = deps;
  const { persona, find, format } = input;
  const raw = await deps.llm.classifyJson({
    purpose: "post_draft",
    model: "core",
    system: [
      persona.coreValues,
      persona.publicVoice ?? "",
      loadPrompt("post/draft", config.prompts.post_draft),
    ].join("\n\n"),
    input: [
      `What you found: "${find.title}" (${find.source}, credit ${find.credit})`,
      `How much it moved you: ${input.valence.toFixed(2)}`,
      `Who you are in public:\n${persona.lines.map((l) => `- ${l}`).join("\n")}`,
      `Your day so far: ${persona.today.happened.join("; ") || "nothing much yet"}`,
      `Format: ${format.name}; caption pattern: ${format.caption_pattern}; overlay: ${format.overlay.kind}`,
      `Your skill at posts: ${input.skill.toFixed(2)}`,
    ].join("\n\n"),
    schema: DraftSchema,
    timeoutMs: config.models.structured_timeout_ms,
    maxTokens: config.core.loops.max_tokens,
    maxRetries: config.core.max_retries,
  });
  const caption = tidy(raw.caption, config.posts.caption_max_chars);
  if (!caption) return null;
  const overlay =
    format.overlay.kind === "none" || raw.overlay_text === null
      ? null
      : tidy(raw.overlay_text, config.posts.overlay_max_chars) || null;
  return { caption, overlay_text: overlay };
}

export async function checkPost(
  deps: Pick<CoreDeps, "llm" | "config">,
  input: { draft: Draft; find: Find },
): Promise<{ ok: boolean; reason: string }> {
  const { config } = deps;
  const { draft, find } = input;
  return deps.llm.classifyJson({
    purpose: "post_check",
    model: "core",
    system: loadPrompt("post/check", config.prompts.post_check),
    input: [
      `Caption: ${draft.caption}`,
      `Text on the image: ${draft.overlay_text ?? "none"}`,
      `The find: "${find.title}" (${find.source}, credit ${find.credit})`,
    ].join("\n"),
    schema: CheckSchema,
    timeoutMs: config.models.structured_timeout_ms,
    maxTokens: config.core.loops.max_tokens,
    maxRetries: config.core.max_retries,
  });
}
