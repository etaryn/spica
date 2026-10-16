import { auth } from "@/server/auth";
import { getDeps } from "@/server/deps";
import { createOnboardingHandler } from "./handler";

export const POST = createOnboardingHandler({
  getUser: async (req) => {
    const s = await auth.api.getSession({ headers: req.headers });
    return s ? { id: s.user.id, name: s.user.name, gender: s.user.gender } : null;
  },
  getDeps,
});
