import { z } from "zod";

export type InspectorEnv = { enabled: boolean; admins: string[] };

/**
 * Off by default in production: staff access to memories is a privacy question.
 * Admins are allowlisted by user id, not email: sign-up emails are unverified, so an
 * email allowlist could be claimed by whoever registers the address first.
 */
export function readInspectorEnv(
  env: Record<string, string | undefined> = process.env,
): InspectorEnv {
  const flag = env.INSPECTOR_ENABLED;
  const enabled =
    flag === undefined || flag === "" ? env.NODE_ENV !== "production" : flag === "true";
  const admins = (env.INSPECTOR_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => z.uuid().safeParse(s).success);
  return { enabled, admins };
}

export function canAccessInspector(userId: string | null | undefined, env: InspectorEnv): boolean {
  return env.enabled && !!userId && env.admins.includes(userId.toLowerCase());
}

export function parseUserIdParam(raw: string): string | null {
  const r = z.uuid().safeParse(raw);
  return r.success ? r.data : null;
}
