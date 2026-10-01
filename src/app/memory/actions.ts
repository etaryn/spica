"use server";

import { revalidatePath } from "next/cache";
import { forgetFact } from "@/db/repos/facts";
import { getDeps } from "@/lib/deps";
import { requireUser } from "@/lib/session";

/** Hard delete of one of the user's own facts. Malformed or foreign ids are a no-op. */
export async function forgetFactAction(factId: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const ok = await forgetFact(getDeps().db, user.id, factId);
  revalidatePath("/memory");
  return { ok };
}
