"use server";

import { revalidatePath } from "next/cache";
import { forgetFact } from "@/db/repos/user/facts";
import { getDeps } from "@/server/deps";
import { requireUser } from "@/server/session";

/** Hard delete of one of the user's own facts. Malformed or foreign ids are a no-op. */
export async function forgetFactAction(factId: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const ok = await forgetFact(getDeps().db, user.id, factId);
  revalidatePath("/memory");
  return { ok };
}
