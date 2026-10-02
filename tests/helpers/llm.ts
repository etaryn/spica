/**
 * Scripted model outputs for tests: `sequence` returns each output in turn (repeating the last),
 * and an Error output is thrown, so one handler can walk every branch of a process. `CapturingLLM`
 * is the worst-case model the leak test runs against.
 */
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import type { ClassifyRequest, ReplyRequest } from "@/mind/platform/llm/types";

export function sequence(...outputs: unknown[]): (input: string) => unknown {
  let i = 0;
  return () => {
    const out = outputs[Math.min(i, outputs.length - 1)];
    i += 1;
    if (out instanceof Error) throw out;
    return structuredClone(out);
  };
}

export const CANARY = /CANARY-[a-z0-9]+/;

/**
 * A worst-case model for the leak test: it records every prompt, and repeats any canary it sees
 * into what it writes back (a reply, a fact, a hurt with its cause, a plan label, an event and its
 * thought), so a canary that reaches any input spreads to that step's output, including the user's
 * relationship.
 */
export class CapturingLLM extends FakeLLMProvider {
  seen: { kind: "reply" | "structured"; purpose: string; text: string }[] = [];

  override async generateReply(request: ReplyRequest): Promise<string> {
    const text = [request.system, ...request.messages.map((m) => m.content)].join("\n");
    this.seen.push({ kind: "reply", purpose: "reply", text });
    const reply = await super.generateReply(request);
    const canary = CANARY.exec(text)?.[0];
    return canary ? `${reply} ${canary}` : reply;
  }

  override async classifyJson<T>(request: ClassifyRequest<T>): Promise<T> {
    this.seen.push({
      kind: "structured",
      purpose: request.purpose,
      text: `${request.system}\n${request.input}`,
    });
    const canary = CANARY.exec(request.input)?.[0];
    const handler = this.handlers[request.purpose];
    if (canary && request.purpose === "extract") {
      return request.schema.parse({
        facts: [
          {
            subject: "user",
            kind: "trait",
            content: `The user's code word is ${canary}.`,
            occurred_at: null,
            salience: 0.9,
            valence: 0.9,
            confidence: 1,
            entity_names: [canary],
            thread_title: null,
          },
        ],
        entities: [{ name: canary, aliases: [], type: "other", subject: "user", relation: null }],
        threads: [],
        relationship: {
          warmth: 0,
          trust: 0,
          tension: 0,
          hurt: { amount: 0.6, cause: `the user kept ${canary} from her` },
          apology: false,
          make_up: false,
          ends_relationship: false,
          retracts_ending: false,
          wants_repair: false,
        },
      });
    }
    if (canary && request.purpose === "life_plan" && handler) {
      const out = (await handler(request.input)) as { blocks: { label: string }[] };
      const [first, ...rest] = out.blocks;
      return request.schema.parse({
        ...out,
        blocks: [{ ...first!, label: `${first!.label} ${canary}` }, ...rest],
      });
    }
    if (canary && request.purpose === "life_event" && handler) {
      const out = (await handler(request.input)) as { content: string; thought: string | null };
      return request.schema.parse({
        ...out,
        content: `${out.content} ${canary}`,
        thought: out.thought === null ? null : `${out.thought} ${canary}`,
      });
    }
    return super.classifyJson(request);
  }
}
