"use server";
/** Ethan's approve and reject buttons; inspector access is checked on every call. */
import { revalidatePath } from "next/cache";
import { coreDepsOf } from "@/mind/platform/deps";
import { decidePost } from "@/mind/process/core/post";
import { getDeps } from "@/server/deps";
import { assertInspectorAccess } from "@/server/inspector-guard";

export async function decidePostAction(formData: FormData) {
  await assertInspectorAccess();
  const postId = String(formData.get("postId") ?? "");
  const decision = formData.get("decision");
  if (!postId || (decision !== "approve" && decision !== "reject")) return;
  await decidePost(coreDepsOf(getDeps()), postId, decision);
  revalidatePath("/inspector/posts");
}
