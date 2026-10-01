import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { loadPersona, parsePersona } from "@/mind/platform/persona";

const doc = `# Core values\nYou are Spica.\n\n## Hard boundaries\n- never threaten\n\n# Seed self\n## Lately\n- films\n\n# Public voice (reference)\nposts`;

test("splits core values from the seed self and ignores the public voice", () => {
  const p = parsePersona(doc);
  expect(p.coreValues).toBe("You are Spica.\n\n## Hard boundaries\n- never threaten");
  expect(p.seedSelf).toBe("## Lately\n- films");
  expect(p.coreValues + p.seedSelf).not.toContain("posts");
});

test("a bullet moved between sections moves with no code change", () => {
  const moved = doc.replace(
    "- never threaten\n\n# Seed self\n",
    "\n# Seed self\n- never threaten\n",
  );
  expect(parsePersona(moved).seedSelf).toContain("never threaten");
});

test("both required sections must be there", () => {
  expect(() => parsePersona("# Core values\nx")).toThrow(/Seed self/);
  expect(() => parsePersona("# Seed self\nx")).toThrow(/Core values/);
});

test("the configured persona file parses", () => {
  const p = loadPersona(loadConfig());
  expect(p.coreValues).toContain("You are Spica.");
  expect(p.seedSelf.length).toBeGreaterThan(0);
});
