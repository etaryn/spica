import { auth } from "@/server/auth";
import { getDeps } from "@/server/deps";
import { createHistoryHandler } from "./handler";

export const GET = createHistoryHandler({
  getUserId: async (req) => (await auth.api.getSession({ headers: req.headers }))?.user.id ?? null,
  getDeps,
});
