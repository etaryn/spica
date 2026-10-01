/**
 * Time for the whole mind. Nothing else may read the wall clock or wait on a real timer, so the
 * evals can run weeks of her life on a simulated clock.
 */

export interface Clock {
  now(): Date;
  /** Waits `ms` (never negative). A simulated clock advances instead of waiting. */
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))),
};

export class SimClock implements Clock {
  private ms: number;

  constructor(start: Date) {
    this.ms = start.getTime();
  }

  now(): Date {
    return new Date(this.ms);
  }

  set(at: Date): void {
    this.ms = at.getTime();
  }

  advance(ms: number): void {
    this.ms += ms;
  }

  async sleep(ms: number): Promise<void> {
    if (ms > 0) this.ms += ms;
  }
}
