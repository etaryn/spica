/**
 * The one-way flow is enforced by ESLint. These cases prove the rule fires for core and world
 * code, and that the per-user legacy folders are exempt until they are deleted.
 */
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint();
const importsUserRepo = 'import { insertFact } from "@/db/repos/user/facts";\nvoid insertFact;\n';
const importsUserMemory =
  'import { retrieve } from "@/mind/memory/user/retrieve";\nvoid retrieve;\n';

const BOUNDARY = "Core and world code never reads user data";

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

  it("exempts the legacy per-user folders", async () => {
    const errors = await errorsFor(importsUserRepo, "src/mind/world/legacy-life-tick/tick.ts");
    expect(hitsBoundary(errors)).toBe(false);
  });
});
