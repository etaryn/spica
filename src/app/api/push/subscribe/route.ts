import { auth } from "@/lib/auth";
import { getDeps } from "@/lib/deps";
import { createPushHandler } from "./handler";

const h = createPushHandler({ getUserId: async (req) => (await auth.api.getSession({ headers: req.headers }))?.user.id ?? null, getDeps });
export const POST = h.POST;
export const DELETE = h.DELETE;
