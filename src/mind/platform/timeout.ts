/**
 * Puts a deadline on any promise. The hot path uses it so a slow lookup costs a missing line in
 * the prompt, never the reply.
 */
import { TimeoutError } from "./errors";

export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
  });

  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
