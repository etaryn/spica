/**
 * How deep a part of her self goes: 1 she'd tell an acquaintance, 2 a friend, 3 only someone
 * close. The core loops judge it as they write; these helpers read it back, including the self
 * snapshot trimmed to what one person may see.
 */
import { z } from "zod";

export const DepthLabel = z.enum(["surface", "personal", "intimate"]);
export type DepthLabelT = z.infer<typeof DepthLabel>;

export function depthOf(label: DepthLabelT | null | undefined, fallback: number): number {
  return label ? DepthLabel.options.indexOf(label) + 1 : fallback;
}

type Block = { heading: string | null; lines: string[] };

function blocks(content: string): Block[] {
  const out: Block[] = [{ heading: null, lines: [] }];
  for (const line of content.split("\n")) {
    if (line.startsWith("### ")) out.push({ heading: line, lines: [] });
    else out.at(-1)!.lines.push(line);
  }
  return out;
}

const bullet = (line: string) => (line.startsWith("- ") ? line.slice(2).trim() : null);

/**
 * Bullets with no known depth stay: dropping part of her self over a missing tag would be worse
 * than showing it. A section left with no bullets goes, heading and all.
 */
export function snapshotWithin(
  content: string,
  lines: { text: string; depth: number }[],
  max: number,
): string {
  const depth = new Map(lines.map((l) => [l.text, l.depth]));
  return blocks(content)
    .map((b) => ({
      heading: b.heading,
      lines: b.lines.filter((line) => {
        const text = bullet(line);
        return text === null || (depth.get(text) ?? 1) <= max;
      }),
    }))
    .filter((b) => b.heading === null || b.lines.some((line) => bullet(line) !== null))
    .map((b) => [...(b.heading ? [b.heading] : []), ...b.lines].join("\n").trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Each bullet with its section's depth; a section not listed is surface. */
export function sectionDepths(
  content: string,
  bySection: Record<string, number>,
): { text: string; depth: number }[] {
  return blocks(content).flatMap((b) => {
    const section = b.heading?.slice(4).trim() ?? "";
    return b.lines.flatMap((line) => {
      const text = bullet(line);
      return text === null ? [] : [{ text, depth: bySection[section] ?? 1 }];
    });
  });
}
