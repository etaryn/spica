/** A post's rendered image, for the inspector only; the path comes from the row, never the URL. */
import { readMedia } from "@/mind/platform/media";
import { getDeps } from "@/server/deps";
import { assertInspectorAccess } from "@/server/inspector-guard";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, ctx: { params: Promise<{ postId: string }> }) {
  await assertInspectorAccess();
  const { postId } = await ctx.params;
  if (!UUID.test(postId)) return new Response("not found", { status: 404 });
  const post = await getDeps().core.posts.getPost(postId);
  if (!post) return new Response("not found", { status: 404 });
  const bytes = await readMedia(post.media_path).catch(() => null);
  if (!bytes) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": "image/png", "cache-control": "no-store" },
  });
}
