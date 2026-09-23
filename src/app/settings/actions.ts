"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { deleteUser } from "@/db/repos/users";
import { auth } from "@/lib/auth";
import { getDeps } from "@/lib/deps";
import { requireUser } from "@/lib/session";

/** Full account deletion (spec §9.2): signs out, then cascades every row from the user. */
export async function deleteAccountAction(formData: FormData) {
  const user = await requireUser();
  if (formData.get("confirm") !== "delete") redirect("/settings?error=confirm");
  await auth.api.signOut({ headers: await headers() });
  await deleteUser(getDeps().db, user.id);
  redirect("/signup");
}
