/**
 * Her self as her own loops read it: the latest nightly snapshot, headed by the night it was
 * written so a "lately" line reads as that old; the seed self before the first night.
 */
import { stamped } from "@/mind/platform/time-anchors";
import type { CoreMemory } from "./types";

export async function latestSelf(
  memory: Pick<CoreMemory, "latestSnapshot">,
  seedSelf: string,
  tz: string,
): Promise<string> {
  const snapshot = await memory.latestSnapshot();
  return snapshot ? stamped(snapshot.content, snapshot.rendered_at, tz) : seedSelf;
}
