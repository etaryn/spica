import { z } from "zod";

export type InspectorEnv = { enabled: boolean; admins: string[] };

/** Off by default in production (DECISIONS.md): staff access to memories is a privacy question. */
export function readInspectorEnv(env: Record<string, string | undefined> = process.env): InspectorEnv {
  const flag = env.INSPECTOR_ENABLED;
  const enabled = flag === undefined || flag === "" ? env.NODE_ENV !== "production" : flag === "true";
  const admins = (env.INSPECTOR_ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return { enabled, admins };
}

export function canAccessInspector(email: string | null | undefined, env: InspectorEnv): boolean {
  return env.enabled && !!email && env.admins.includes(email.toLowerCase());
}

export function parseUserIdParam(raw: string): string | null {
  const r = z.uuid().safeParse(raw);
  return r.success ? r.data : null;
}
