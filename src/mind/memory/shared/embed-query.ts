/**
 * Embeds a retrieval query under the retrieval deadline. A reply embeds its query once and hands
 * the vector to both minds' retrieval, so one conversation never pays for the same text twice.
 */
import type { Deps } from "@/mind/platform/deps";
import { withTimeout } from "@/mind/platform/timeout";

/** Null when there's nothing to rank against (a check-in with no turns); throws on failure. */
export async function embedQuery(
  deps: Pick<Deps, "embedder" | "config">,
  text: string,
): Promise<number[] | null> {
  if (text.trim() === "") return null;
  const [vector] = await withTimeout(
    deps.embedder.embed([text], "query"),
    deps.config.retrieval.embed_timeout_ms,
  );
  if (!vector) throw new Error("embedder returned no vector");
  return vector;
}
