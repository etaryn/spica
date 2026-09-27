import { auth } from "@/lib/auth";
import { getDeps } from "@/lib/deps";
import { getEventHub } from "@/lib/event-hub";
import { createEventsHandler } from "./handler";

export const GET = createEventsHandler({
  getUserId: async (req) => (await auth.api.getSession({ headers: req.headers }))?.user.id ?? null,
  getDeps,
  subscribe: (userId, fn) => getEventHub().subscribe(userId, fn),
});
