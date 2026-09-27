export interface Clock {
  now(): Date;
  /** Waits `ms` (never negative). Simulated clocks advance instead of waiting. */
  sleep(ms: number): Promise<void>;
}

/** The only place in src/core allowed to read wall-clock time or wait on a real timer. */
export const systemClock: Clock = {
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))),
};

export class SimClock implements Clock {
  private t: number;
  constructor(start: Date) { this.t = start.getTime(); }
  now(): Date { return new Date(this.t); }
  set(d: Date): void { this.t = d.getTime(); }
  advance(ms: number): void { this.t += ms; }
  async sleep(ms: number): Promise<void> { if (ms > 0) this.t += ms; }
}
