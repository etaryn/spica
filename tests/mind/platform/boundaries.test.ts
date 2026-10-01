/**
 * The one-way flow is enforced by ESLint. These cases prove the rule fires for core and world
 * code (and the shared code both minds use), however the import is written.
 */
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint();
const importsUserRepo = 'import { insertFact } from "@/db/repos/user/facts";\nvoid insertFact;\n';
const importsUserMemory =
  'import { retrieve } from "@/mind/memory/user/retrieve";\nvoid retrieve;\n';

const BOUNDARY = "Core, world and shared code never read user data";

async function errorsFor(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result!.messages.map((m) => m.message);
}

function hitsBoundary(errors: string[]): boolean {
  return errors.some((message) => message.includes(BOUNDARY));
}

describe("one-way flow", () => {
  it("stops core code importing a user repo", async () => {
    const errors = await errorsFor(importsUserRepo, "src/mind/state/core/mood.ts");
    expect(hitsBoundary(errors)).toBe(true);
  });

  it("stops world code importing user memory", async () => {
    const errors = await errorsFor(importsUserMemory, "src/mind/world/day-plan.ts");
    expect(hitsBoundary(errors)).toBe(true);
  });

  it("lets process code read user data", async () => {
    const errors = await errorsFor(importsUserRepo, "src/mind/process/hot-path/compose.ts");
    expect(hitsBoundary(errors)).toBe(false);
  });

  it("stops core process code importing a user repo", async () => {
    const errors = await errorsFor(importsUserRepo, "src/mind/process/core/world-tick.ts");
    expect(hitsBoundary(errors)).toBe(true);
  });

  it("stops a relative import of user code", async () => {
    const code =
      'import type { Params } from "../user/relationship/types";\nexport type X = Params;\n';
    const errors = await errorsFor(code, "src/mind/state/core/mood.ts");
    expect(hitsBoundary(errors)).toBe(true);
  });

  it("stops core and world code using the cross-user admin repos", async () => {
    const code =
      'import { adminListOutreachUsers } from "@/db/repos/admin/relationship";\nvoid adminListOutreachUsers;\n';
    const errors = await errorsFor(code, "src/mind/world/day-plan.ts");
    expect(hitsBoundary(errors)).toBe(true);
  });

  it("stops world code importing process code, which reads user data", async () => {
    const code =
      'import { composeReply } from "@/mind/process/hot-path/compose";\nvoid composeReply;\n';
    const errors = await errorsFor(code, "src/mind/world/day-plan.ts");
    expect(hitsBoundary(errors)).toBe(true);
  });

  it("stops shared code, which both minds use, importing a user repo", async () => {
    const errors = await errorsFor(importsUserRepo, "src/mind/memory/shared/ranking.ts");
    expect(hitsBoundary(errors)).toBe(true);
  });

  it("stops the core repos importing a user repo", async () => {
    const errors = await errorsFor(importsUserRepo, "src/db/repos/core/memory.ts");
    expect(hitsBoundary(errors)).toBe(true);
  });

  it("lets core loops in process/core be imported by world code", async () => {
    const code =
      'import { appraiseEvent } from "@/mind/process/core/appraise";\nvoid appraiseEvent;\n';
    const errors = await errorsFor(code, "src/mind/world/events.ts");
    expect(hitsBoundary(errors)).toBe(false);
  });

  it("stops core loops importing user process code", async () => {
    const code =
      'import { composeReply } from "@/mind/process/hot-path/compose";\nvoid composeReply;\n';
    const errors = await errorsFor(code, "src/mind/process/core/world-tick.ts");
    expect(hitsBoundary(errors)).toBe(true);
  });
});
