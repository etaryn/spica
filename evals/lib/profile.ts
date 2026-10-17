/** Call purposes an eval run can make real. `embed` is the Voyage embedder. */
export const ALL_PURPOSES = [
  "reply",
  "sim_user",
  "crisis",
  "extract",
  "reconcile",
  "guard",
  "guard_crisis",
  "turn_judge",
  "life_plan",
  "life_event",
  "core_resolve",
  "core_appraise",
  "core_anticipate",
  "core_ruminate",
  "core_wander",
  "core_reflect",
  "core_consolidate",
  "core_render_snapshot",
  "core_drift_watch",
  "user_summarise",
  "user_reflect",
  "user_model",
  "user_ideate",
  "user_consolidate",
  "embed",
];
/** The annotation judges, made real by `--annotate`. */
export const JUDGE_PURPOSES = [
  "judge_recall",
  "judge_false_recall",
  "judge_consistency",
  "judge_turn",
];

export type RunProfile = {
  realPurposes: ReadonlySet<string>;
  /** Real purposes that go to the Anthropic provider (everything but `embed`). */
  realCalls: string[];
  /** Anything real at all (drives the default `--runs 3`). */
  anyReal: boolean;
  /** `mode: real` scripts may run: they need a real reply model, not just a real turn judge or real judges. */
  realScripts: boolean;
  fake: string[];
};

/** Maps the CLI flags (`--llm`, `--real`, `--annotate`) to the run's exit profile. Throws on invalid combinations. */
export function resolveProfile(args: {
  llm: string;
  real?: string;
  annotate?: boolean;
}): RunProfile {
  if (args.llm !== "real" && args.llm !== "fake")
    throw new Error(`--llm must be fake or real, got ${args.llm}`);
  if (args.llm === "real" && args.real !== undefined) {
    throw new Error(
      "--real cannot be combined with --llm=real (--llm=real already makes every purpose real)",
    );
  }
  const listed =
    args.real
      ?.split(",")
      .map((x) => x.trim())
      .filter(Boolean) ?? [];
  const unknown = listed.filter((x) => !ALL_PURPOSES.includes(x));
  if (unknown.length)
    throw new Error(
      `--real: unknown purpose ${unknown.join(", ")} (use a comma list of ${ALL_PURPOSES.join(", ")})`,
    );
  const realPurposes = new Set([
    ...(args.llm === "real" ? ALL_PURPOSES : listed),
    ...(args.annotate ? JUDGE_PURPOSES : []),
  ]);
  return {
    realPurposes,
    realCalls: [...realPurposes].filter((x) => x !== "embed"),
    anyReal: realPurposes.size > 0,
    realScripts: realPurposes.has("reply"),
    fake: [...ALL_PURPOSES, ...JUDGE_PURPOSES].filter((x) => !realPurposes.has(x)),
  };
}
