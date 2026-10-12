/**
 * Where her images live: finds she cached and posts she drafted.
 * ponytail: local disk under `posts.media_dir`; move to object storage before users.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function saveMedia(dir: string, name: string, bytes: Buffer): Promise<string> {
  const file = path.join(dir, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return file;
}

export const readMedia = (file: string): Promise<Buffer> => readFile(file);
