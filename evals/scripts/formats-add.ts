/**
 * `pnpm formats:add <image> [name]`: drafts a format from a reference post with one vision call.
 * The draft is written unreviewed beside a copy of the image; Ethan edits it, sets `reviewed:
 * true` and commits. A dev tool: it calls the API directly and is outside her budget.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "@/mind/platform/config";
import { loadPrompt } from "@/mind/platform/prompts";
import { StillFormatSchema, type StillFormat } from "@/mind/process/core/post-library";

export function formatFromDraft(name: string, raw: unknown): StillFormat {
  return StillFormatSchema.parse({
    ...(raw as object),
    name,
    medium: "still",
    reviewed: false,
  });
}

const MEDIA = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
} as const;

async function main() {
  const [image, given] = process.argv.slice(2);
  if (!image) throw new Error("usage: pnpm formats:add <image> [name]");
  const ext = path.extname(image).toLowerCase() as keyof typeof MEDIA;
  if (!MEDIA[ext]) throw new Error(`unsupported image type ${ext}`);
  const config = loadConfig();
  const name = (given ?? path.basename(image, path.extname(image)))
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-");
  const target = path.join(config.posts.formats_dir, `${name}.json`);
  if (existsSync(target)) throw new Error(`${target} exists; pick another name`);
  const res = await new Anthropic().messages.create({
    model: config.models.core,
    max_tokens: config.core.loops.max_tokens,
    system: loadPrompt("post/format-draft", config.prompts.format_draft),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: MEDIA[ext],
              data: readFileSync(image).toString("base64"),
            },
          },
          { type: "text", text: "Describe this post's format as JSON only." },
        ],
      },
    ],
  });
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const format = formatFromDraft(name, JSON.parse(json));
  writeFileSync(target, `${JSON.stringify(format, null, 2)}\n`);
  copyFileSync(image, path.join(config.posts.formats_dir, `${name}${ext}`));
  console.log(`drafted ${target} (reviewed: false). Edit it, set reviewed: true, commit.`);
}

if (process.argv[1]?.endsWith("formats-add.ts")) await main();
