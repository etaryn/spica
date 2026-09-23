export interface Clock {
  now(): Date;
}

/** The only place in src/core allowed to read wall-clock time. */
export const systemClock: Clock = { now: () => new Date() };

export class SimClock implements Clock {
  private t: number;
  constructor(start: Date) { this.t = start.getTime(); }
  now(): Date { return new Date(this.t); }
  set(d: Date): void { this.t = d.getTime(); }
  advance(ms: number): void { this.t += ms; }
}
