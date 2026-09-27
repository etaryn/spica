import { auth } from "@/lib/auth";
import { getDeps } from "@/lib/deps";
import { createHistoryHandler } from "./handler";

export const GET = createHistoryHandler({
  getUserId: async (req) => (await auth.api.getSession({ headers: req.headers }))?.user.id ?? null,
  getDeps,
});
