import { z } from "zod";
import { parseConfigOverrides } from "@/core/config";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  VOYAGE_API_KEY: z.string().min(1).optional(),
  SPICA_CONFIG: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema> & { configOverrides: unknown };

export function readEnv(env: Record<string, string | undefined> = process.env): Env {
  // `KEY=` lines in .env arrive as "", which means unset, not an invalid value.
  const present = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = EnvSchema.safeParse({ ...present, DATABASE_URL: present.DATABASE_URL ?? "" });
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
  return { ...parsed.data, configOverrides: parseConfigOverrides(parsed.data.SPICA_CONFIG) };
}
