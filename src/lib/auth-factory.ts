import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { checkAge } from "@/core/age";
import type { Config } from "@/core/config";
import type { Db } from "@/db/client";
import { account, session, user, verification } from "@/db/schema";

export function createAuth(db: Db, config: Config, opts: { secret?: string; baseURL?: string; plugins?: BetterAuthPlugin[] } = {}) {
  return betterAuth({
    secret: opts.secret,
    baseURL: opts.baseURL,
    database: drizzleAdapter(db, { provider: "pg", schema: { user, session, account, verification } }),
    emailAndPassword: { enabled: true, minPasswordLength: config.auth.min_password_length },
    user: {
      additionalFields: {
        dateOfBirth: { type: "string", required: true, input: true },
      },
    },
    advanced: { database: { generateId: "uuid" } },
    databaseHooks: {
      user: {
        create: {
          before: async (u) => {
            const dob = (u as { dateOfBirth?: unknown }).dateOfBirth;
            const result = checkAge(typeof dob === "string" ? dob : "", new Date(), config.auth.min_age);
            if (!result.ok) throw new APIError("BAD_REQUEST", { message: result.reason });
            return { data: u };
          },
        },
      },
    },
    plugins: opts.plugins ?? [],
  });
}
