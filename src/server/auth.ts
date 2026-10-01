/**
 * The app's Better Auth instance.
 */
import "server-only";
import { nextCookies } from "better-auth/next-js";
import { createAuth } from "./auth-factory";
import { getDeps } from "./deps";

export const auth = createAuth(getDeps().db, getDeps().config, { plugins: [nextCookies()] });
