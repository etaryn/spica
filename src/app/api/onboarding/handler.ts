/**
 * POST /api/onboarding: the finished profile card. 201 saved, 400 bad answers, 409 already met her
 * or the quiz changed under them, 503 when saving failed and a retry may work.
 */
import type { Deps } from "@/mind/platform/deps";
import { submitCard } from "@/mind/process/onboarding/submit";

export function createOnboardingHandler(opts: {
  getUser(req: Request): Promise<{ id: string; name: string } | null>;
  getDeps(): Deps;
}) {
  return async function POST(req: Request): Promise<Response> {
    const user = await opts.getUser(req);
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
    const deps = opts.getDeps();
    try {
      const r = await submitCard(deps, user, body);
      return r.status === 201
        ? new Response(null, { status: 201 })
        : Response.json({ error: r.error }, { status: r.status });
    } catch (e) {
      deps.log.error("onboarding submit failed", {
        error: e instanceof Error ? e.name : "unknown",
      });
      return Response.json({ error: "try_again" }, { status: 503 });
    }
  };
}
