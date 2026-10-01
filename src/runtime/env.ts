import { z } from "zod";
import { parseConfigOverrides } from "@/mind/platform/config";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  VOYAGE_API_KEY: z.string().min(1).optional(),
  SPICA_CONFIG: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema> & { configOverrides: unknown };

/** The public VAPID key for the app pages, or null when web push isn't fully configured. */
export function vapidPublicKey(env: Env): string | null {
  return env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT
    ? env.VAPID_PUBLIC_KEY
    : null;
}

export function readEnv(env: Record<string, string | undefined> = process.env): Env {
  // `KEY=` lines in .env arrive as "", which means unset, not an invalid value.
  const present = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""),
  );
  const parsed = EnvSchema.safeParse({ ...present, DATABASE_URL: present.DATABASE_URL ?? "" });
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
  return { ...parsed.data, configOverrides: parseConfigOverrides(parsed.data.SPICA_CONFIG) };
}
