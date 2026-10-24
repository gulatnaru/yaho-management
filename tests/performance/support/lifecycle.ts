import { requireFact } from "./contract";

type Cleanup = "PASS" | "FAIL" | "UNKNOWN";

// Runner timeouts settle the runner's wrapper, not the work it started.
export class HarnessLifecycle<Fixture> {
  readonly operations = new Set<Promise<void>>();
  readonly fixtures = new Map<Fixture, Cleanup>();
  stopped = false;
  private closed = false;

  stop(): void { this.stopped = true; this.closed = true; }
  run(work: () => Promise<void>): Promise<void> {
    if (this.closed) return Promise.resolve();
    const operation = Promise.resolve().then(async () => { if (!this.closed) await work(); });
    this.operations.add(operation);
    void operation.then(() => this.operations.delete(operation), () => this.operations.delete(operation));
    return operation;
  }
  own(fixture: Fixture): void {
    requireFact(!this.closed && !this.fixtures.has(fixture), "INCOMPLETE");
    this.fixtures.set(fixture, "UNKNOWN");
  }
  async drain(): Promise<void> {
    this.closed = true;
    while (this.operations.size) await Promise.allSettled([...this.operations]);
  }
  async clean(fixture: Fixture, cleanup: () => Promise<void>): Promise<void> {
    requireFact(this.fixtures.has(fixture), "CLEANUP");
    if (this.fixtures.get(fixture) === "PASS") return;
    try { await cleanup(); this.fixtures.set(fixture, "PASS"); }
    catch (error) { this.fixtures.set(fixture, "FAIL"); throw error; }
  }
  cleanupStatus(fixtures: readonly Fixture[] = [...this.fixtures.keys()]): Cleanup {
    const states = fixtures.map((fixture) => this.fixtures.get(fixture) ?? "UNKNOWN");
    return states.includes("FAIL") ? "FAIL" : states.includes("UNKNOWN") ? "UNKNOWN" : "PASS";
  }
}
