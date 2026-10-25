/**
 * Scripted model outputs for tests: `sequence` returns each output in turn (repeating the last),
 * and an Error output is thrown, so one handler can walk every branch of a process. `CapturingLLM`
 * is the worst-case model the leak test runs against.
 */
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import { scriptedLabels } from "@/mind/platform/llm/fake-labels";
import { type ClassifyRequest, type ReplyRequest, systemText } from "@/mind/platform/llm/types";

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
 * into what it writes back (a reply, a fact, a labelled memory and the hurt worded by the user's
 * words holding it, a hurt with its cause, a plan label, an event and its
 * thought, an appraisal's episode and feeling, a reflection, a gist, a snapshot, a user summary,
 * a reflection, an idea, a read, a belief and a gist about a user, and a drift finding), so a
 * canary that reaches any input spreads to that step's output, including the user's relationship.
 */
export class CapturingLLM extends FakeLLMProvider {
  seen: { kind: "reply" | "structured"; purpose: string; text: string }[] = [];

  override async generateReply(request: ReplyRequest): Promise<string> {
    const text = [systemText(request.system), ...request.messages.map((m) => m.content)].join("\n");
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
    if (canary && request.purpose.startsWith("labels_")) {
      const labels = scriptedLabels({
        memories: [
          {
            said: canary,
            label: `code word ${canary}`,
            kind: "trait",
            salience: 0.9,
            valence: 0.9,
            mention: { words: canary, name: canary },
          },
        ],
        relationship: { hurt: { amount: 0.6, said: canary } },
      });
      return request.schema.parse(labels[request.purpose as keyof typeof labels](request.input));
    }
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
    if (canary && request.purpose === "core_appraise" && handler) {
      const out = (await handler(request.input)) as {
        episode: string;
        emotion: { label: string };
      };
      return request.schema.parse({
        ...out,
        episode: `${out.episode} ${canary}`,
        emotion: { ...out.emotion, label: `${out.emotion.label} ${canary}` },
      });
    }
    if (canary && request.purpose === "core_resolve" && handler) {
      const out = (await handler(request.input)) as { content: string };
      return request.schema.parse({ ...out, content: `${out.content} ${canary}` });
    }
    if (canary && ["core_anticipate", "core_ruminate"].includes(request.purpose) && handler) {
      const out = (await handler(request.input)) as { thought: { content: string } };
      return request.schema.parse({
        ...out,
        thought: { ...out.thought, content: `${out.thought.content} ${canary}` },
      });
    }
    if (canary && request.purpose === "core_wander" && handler) {
      const out = (await handler(request.input)) as { items: { content: string }[] };
      return request.schema.parse({
        ...out,
        items: out.items.map((item) => ({ ...item, content: `${item.content} ${canary}` })),
      });
    }
    if (canary && request.purpose === "core_reflect" && handler) {
      const out = (await handler(request.input)) as { narrative: string | null };
      return request.schema.parse({ ...out, narrative: `${out.narrative ?? "Lately"} ${canary}` });
    }
    if (canary && request.purpose === "core_consolidate" && handler) {
      const out = (await handler(request.input)) as { gist: string };
      return request.schema.parse({ ...out, gist: `${out.gist} ${canary}` });
    }
    if (canary && request.purpose === "core_render_snapshot" && handler) {
      const out = (await handler(request.input)) as { Lately: string[] };
      return request.schema.parse({ ...out, Lately: [`${out.Lately[0] ?? "Lately"} ${canary}`] });
    }
    if (canary && request.purpose === "user_summarise" && handler) {
      const out = (await handler(request.input)) as { how_i_feel: string };
      return request.schema.parse({ ...out, how_i_feel: `${out.how_i_feel} ${canary}` });
    }
    if (canary && request.purpose === "user_reflect" && handler) {
      const out = (await handler(request.input)) as { reflection: string | null };
      return request.schema.parse({
        ...out,
        reflection: `${out.reflection ?? "I noticed"} ${canary}`,
      });
    }
    if (canary && request.purpose === "user_ideate" && handler) {
      const out = (await handler(request.input)) as { idea: string | null };
      return request.schema.parse({ ...out, idea: `${out.idea ?? "Ask"} ${canary}` });
    }
    if (canary && request.purpose === "user_model" && handler) {
      const out = (await handler(request.input)) as {
        how_they_are: string;
        beliefs: { text: string; replaces: string | null }[];
      };
      return request.schema.parse({
        ...out,
        how_they_are: `${out.how_they_are} ${canary}`,
        beliefs: [
          ...out.beliefs.map((b) => ({ ...b, text: `${b.text} ${canary}` })),
          { text: `They guard ${canary}.`, replaces: null },
        ],
      });
    }
    if (canary && request.purpose === "user_consolidate" && handler) {
      const out = (await handler(request.input)) as { gist: string };
      return request.schema.parse({ ...out, gist: `${out.gist} ${canary}` });
    }
    if (canary && request.purpose === "core_drift_watch") {
      return request.schema.parse({
        findings: [{ value: "honesty", excerpt: canary, verdict: "strains" }],
      });
    }
    return super.classifyJson(request);
  }
}
