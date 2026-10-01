import { auth } from "@/server/auth";
import { getDeps } from "@/server/deps";
import { createChatHandler } from "./handler";

export const POST = createChatHandler({
  getUserId: async (req) => (await auth.api.getSession({ headers: req.headers }))?.user.id ?? null,
  getDeps,
});
