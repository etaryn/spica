/**
 * Builds Better Auth: email and password, the server-side 18+ gate at sign-up, and the extra
 * user fields.
 */
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { checkAge } from "@/mind/platform/age-gate";
import type { Config } from "@/mind/platform/config";
import type { Db } from "@/db/client";
import { account, session, user, verification } from "@/db/schema";
import { isGender } from "@/mind/process/onboarding/gender";

export function createAuth(
  db: Db,
  config: Config,
  opts: { secret?: string; baseURL?: string; plugins?: BetterAuthPlugin[] } = {},
) {
  return betterAuth({
    secret: opts.secret,
    baseURL: opts.baseURL,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user, session, account, verification },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: config.auth.min_password_length },
    user: {
      additionalFields: {
        dateOfBirth: { type: "string", required: true, input: true },
        gender: { type: "string", required: true, input: true },
      },
    },
    advanced: { database: { generateId: "uuid" } },
    databaseHooks: {
      user: {
        create: {
          before: async (u) => {
            const dob = (u as { dateOfBirth?: unknown }).dateOfBirth;
            const result = checkAge(
              typeof dob === "string" ? dob : "",
              new Date(),
              config.auth.min_age,
            );
            if (!result.ok) throw new APIError("BAD_REQUEST", { message: result.reason });
            if (!isGender((u as { gender?: unknown }).gender))
              throw new APIError("BAD_REQUEST", { message: "Choose a gender option." });
            // Stray spaces would show on her side of the card and in every reply.
            return { data: { ...u, name: u.name.trim() } };
          },
        },
      },
    },
    plugins: opts.plugins ?? [],
  });
}
