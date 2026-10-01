/**
 * Scripted model outputs for tests: `sequence` returns each output in turn (repeating the last), and
 * an Error output is thrown, so one handler can walk every branch of a process.
 */
export function sequence(...outputs: unknown[]): (input: string) => unknown {
  let i = 0;
  return () => {
    const out = outputs[Math.min(i, outputs.length - 1)];
    i += 1;
    if (out instanceof Error) throw out;
    return structuredClone(out);
  };
}
