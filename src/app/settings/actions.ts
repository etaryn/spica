"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { deleteUser } from "@/db/repos/user/users";
import { auth } from "@/server/auth";
import { getDeps } from "@/server/deps";
import { requireUser } from "@/server/session";

/** Full account deletion: signs out, then cascades every row from the user. */
export async function deleteAccountAction(formData: FormData) {
  const user = await requireUser();
  if (formData.get("confirm") !== "delete") redirect("/settings?error=confirm");
  await auth.api.signOut({ headers: await headers() });
  await deleteUser(getDeps().db, user.id);
  redirect("/signup");
}
