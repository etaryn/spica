import "server-only";
import { notFound } from "next/navigation";
import { canAccessInspector, readInspectorEnv } from "./inspector-access";
import { getSessionUser } from "./session";

/** 404 (not 403) so the inspector's existence isn't advertised. Call in every inspector loader. */
export async function assertInspectorAccess(): Promise<void> {
  const user = await getSessionUser();
  if (!canAccessInspector(user?.email, readInspectorEnv())) notFound();
}
