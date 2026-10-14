import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { usableBackchannel } from "@/mind/process/turn-taking/judge";

const turn = loadConfig().turn;
const mid = (backchannel: string | null) => ({ complete: false, backchannel });

test("no backchannel on a greeting-only buffer", () => {
  expect(usableBackchannel(mid("hey"), ["hey"], turn)).toBeNull();
  expect(usableBackchannel(mid("hiii"), ["hiii!", "heyyy"], turn)).toBeNull();
  expect(usableBackchannel(mid("oh hi"), ["good morning"], turn)).toBeNull();
});

test("no backchannel that repeats their words", () => {
  expect(usableBackchannel(mid("no way"), ["no way", "so guess what"], turn)).toBeNull();
});

test("a real mid-story reaction is kept, emoji-only included", () => {
  expect(usableBackchannel(mid("wait what"), ["so my landlord just"], turn)).toBe("wait what");
  expect(usableBackchannel(mid("😂"), ["you won't believe this"], turn)).toBe("😂");
});

test("never when complete, never too long", () => {
  expect(usableBackchannel({ complete: true, backchannel: "omg" }, ["story"], turn)).toBeNull();
  expect(usableBackchannel(mid("oh my god no way that is wild"), ["so then"], turn)).toBeNull();
});
