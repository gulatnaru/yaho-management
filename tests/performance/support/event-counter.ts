import { performance } from "node:perf_hooks";
import { attributionFailure, requireFact, SafeFailure, type AttributionContext } from "./contract";

// A JS event-loop turn is not a native query-log delivery fence. These bounds
// limit waiting; exact expected totals, rather than quiet time alone, establish
// coverage for known calibration work. No event is ever discarded or reset as
// a way to recover from contamination.
const QUIET_MS = 25;
const DELIVERY_TIMEOUT_MS = 1000;
export type CounterClock = { now(): number; pause(): Promise<void> };
const clock: CounterClock = { now: () => performance.now(), pause: () => new Promise((resolve) => setTimeout(resolve, 5)) };

export class EventCounter {
  active = false;
  events = 0;
  late = 0;
  private fenced = false;
  private began = false;
  private terminal: 0 | 1 | 2 = 0;
  private controlOrder = true;
  constructor(private readonly time: CounterClock = clock) {}
  event(query?: string): void {
    if (!this.active || (this.fenced && this.terminal !== 0)) { this.late++; return; }
    this.events++;
    if (!this.fenced) return;
    // Approved 2026-10-23 exception: compare only these exact pinned-engine
    // constants, with no normalization. Never retain the query/event payload.
    if (query === "BEGIN") { if (this.began) this.controlOrder = false; this.began = true; }
    else if (query === "COMMIT") { this.controlOrder &&= this.began; this.terminal = 1; }
    else if (query === "ROLLBACK") { this.controlOrder &&= this.began; this.terminal = 2; }
  }
  start(): void {
    requireFact(!this.active, "CLIENT_BUSY");
    requireFact(this.late === 0, "LATE_EVENT");
    this.events = 0; this.active = true;
    this.fenced = false; this.began = false; this.terminal = 0; this.controlOrder = true;
  }
  startFenced(): void { this.start(); this.fenced = true; }
  stop(): number { requireFact(this.active, "CLIENT_BUSY"); this.active = false; return this.events; }
  async complete(expected: number, context: AttributionContext): Promise<number> {
    requireFact(this.active, "CLIENT_BUSY");
    const started = this.time.now();
    let observed = this.events, stableSince = started;
    try {
      for (;;) {
        if (this.events > expected) throw attributionFailure(context, "EXTRA", expected, this.events, this.late);
        const now = this.time.now();
        if (observed !== this.events) { observed = this.events; stableSince = now; }
        if (this.events === expected && now - stableSince >= QUIET_MS) return this.events;
        if (now - started >= DELIVERY_TIMEOUT_MS) throw attributionFailure(context, this.events === expected ? "UNSTABLE" : "MISSING", expected, this.events, this.late);
        await this.time.pause();
      }
    } finally { this.stop(); }
  }
  async completeFenced(committed: boolean, context: AttributionContext): Promise<number> {
    requireFact(this.active && this.fenced, "CLIENT_BUSY");
    const started = this.time.now(), expectedTerminal = committed ? 1 : 2;
    let observed = this.events, stableSince = started;
    try {
      for (;;) {
        if (this.late) throw attributionFailure(context, "LATE", 0, this.late, this.late);
        if (!this.controlOrder) throw attributionFailure(context, "FENCE_ORDER", 1, 0);
        if (this.terminal !== 0 && this.terminal !== expectedTerminal) throw attributionFailure(context, "FENCE_OUTCOME", expectedTerminal, this.terminal);
        const now = this.time.now();
        if (observed !== this.events) { observed = this.events; stableSince = now; }
        if (this.terminal === expectedTerminal && now - stableSince >= QUIET_MS) return this.events;
        if (now - started >= DELIVERY_TIMEOUT_MS) throw attributionFailure(context, this.terminal === 0 ? "UNPROVEN" : "UNSTABLE", 1, this.terminal === expectedTerminal ? 1 : 0, this.late);
        await this.time.pause();
      }
    } finally { this.stop(); }
  }
  async drain(): Promise<void> {
    requireFact(!this.active, "CLIENT_BUSY");
    const started = this.time.now();
    for (;;) {
      if (this.late) throw new SafeFailure("LATE_EVENT");
      if (this.time.now() - started >= QUIET_MS) return;
      await this.time.pause();
    }
  }
}
