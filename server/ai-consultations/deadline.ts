import { AiDenied } from "@/lib/ai-consultations/contracts";
export const STAGE_MS = {
  auth: 600,
  claim: 400,
  agent: 2200,
  settle: 500,
} as const;
export class Deadline {
  readonly controller = new AbortController();
  private readonly started: number;
  constructor(
    private readonly now: () => number = () => performance.now(),
    readonly total = 4000,
  ) {
    this.started = now();
  }
  remaining() {
    return Math.max(0, this.total - (this.now() - this.started));
  }
  assert() {
    if (this.controller.signal.aborted || this.remaining() <= 300) {
      this.controller.abort();
      throw new AiDenied();
    }
  }
  async stage<T>(
    name: keyof typeof STAGE_MS,
    fn: (signal: AbortSignal, ms: number) => Promise<T>,
  ): Promise<T> {
    this.assert();
    const ms = Math.min(STAGE_MS[name], this.remaining() - 300);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => this.controller.abort();
    try {
      return await Promise.race([
        fn(this.controller.signal, ms).then((x) => {
          this.assert();
          return x;
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            abort();
            reject(new AiDenied());
          }, ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  abort() {
    this.controller.abort();
  }
}
