import { describe, it, expect, vi, afterEach } from "vitest";
import { mockSkillHandler } from "@/server/ai-consultations/handler";
import { Deadline } from "@/server/ai-consultations/deadline";
import { AI_PROOF_HEADER } from "@/server/ai-consultations/runtime";
import { HUMAN_HANDOFF } from "@/lib/ai-consultations/contracts";
import { environment, skill, proof, memoryClient } from "./fixtures";
function request(input = skill()) {
  const body = JSON.stringify(input);
  return new Request(
    "https://example.invalid/api/ai-consultations/mock-skill",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [AI_PROOF_HEADER]: proof(body),
      },
      body,
    },
  );
}
afterEach(() => vi.useRealTimers());
describe("AC21-01/07/12/13 Mock Skill route flow", () => {
  it("authenticated synthetic skill persists only ciphertext and anonymous metrics", async () => {
    const db = memoryClient();
    const provider = {
      plan: vi
        .fn()
        .mockResolvedValue({ name: "list_public_programs", args: {} }),
    };
    const execute = vi.fn().mockResolvedValue({
      kind: "PROGRAMS",
      items: [
        {
          handle: "program-1",
          name: "[SYNTHETIC] sample",
          description: null,
          targetAgeMin: 5,
          targetAgeMax: 8,
        },
      ],
    });
    const handler = mockSkillHandler({
      environment: environment(),
      client: async () => db.client,
      provider,
      tools: () => ({ execute }),
    });
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const json = await response.json();
    expect(json.version).toBe("2.0");
    expect(json.template.outputs[0].simpleText.text).toContain("SYNTHETIC");
    expect(db.state.consultations[0].status).toBe("DONE");
    expect(JSON.stringify(db.state.consultations)).not.toContain(
      "야호 프로그램",
    );
    expect(provider.plan).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(provider.plan.mock.calls)).not.toContain(
      "private-class-id",
    );
    expect(JSON.stringify(provider.plan.mock.calls)).not.toContain(
      "synthetic-guardian0001",
    );
    expect(db.state.metrics[0].count).toBe(1);
  });
  it("duplicate DONE revalidates facts without a second provider call or quota charge", async () => {
    const db = memoryClient();
    const provider = {
      plan: vi
        .fn()
        .mockResolvedValue({ name: "list_public_programs", args: {} }),
    };
    const execute = vi.fn().mockResolvedValue({ kind: "PROGRAMS", items: [] });
    const handler = mockSkillHandler({
      environment: environment(),
      client: async () => db.client,
      provider,
      tools: () => ({ execute }),
    });
    const input = skill();
    await handler(request(input));
    await handler(request(input));
    expect(provider.plan).toHaveBeenCalledTimes(1);
    expect(db.state.consultations).toHaveLength(1);
    expect(db.state.quotas.every((x) => x.accepted === 1)).toBe(true);
  });
  it("DONE replay after publication revoke never returns cached previously approved facts", async () => {
    const db = memoryClient();
    const provider = {
      plan: vi
        .fn()
        .mockResolvedValue({ name: "list_public_programs", args: {} }),
    };
    let published = true;
    const execute = vi.fn(async () => ({
      kind: "PROGRAMS" as const,
      items: published
        ? [
            {
              handle: "program-1",
              name: "[SYNTHETIC] sample",
              description: null,
              targetAgeMin: 5,
              targetAgeMax: 8,
            },
          ]
        : [],
    }));
    const handler = mockSkillHandler({
      environment: environment(),
      client: async () => db.client,
      provider,
      tools: () => ({ execute }),
    });
    const input = skill();
    expect(await (await handler(request(input))).text()).toContain("sample");
    published = false;
    const replay = await (await handler(request(input))).text();
    expect(replay).toContain(HUMAN_HANDOFF);
    expect(replay).not.toContain("sample");
    expect(provider.plan).toHaveBeenCalledTimes(1);
    expect(db.state.quotas.every((x) => x.accepted === 1)).toBe(true);
  });
  it("DONE availability replay uses current status without provider reprocessing", async () => {
    const db = memoryClient();
    const provider = {
      plan: vi
        .fn()
        .mockResolvedValue({
          name: "get_class_availability",
          args: { classHandle: "class-1" },
        }),
    };
    let available = true;
    const execute = vi.fn(async () => ({
      kind: "AVAILABILITY" as const,
      status: available ? ("AVAILABLE" as const) : ("UNAVAILABLE" as const),
    }));
    const handler = mockSkillHandler({
      environment: environment(),
      client: async () => db.client,
      provider,
      tools: () => ({ execute }),
    });
    const input = skill("AVAILABILITY");
    expect(await (await handler(request(input))).text()).toContain(
      "현재 예약 가능한",
    );
    available = false;
    expect(await (await handler(request(input))).text()).toContain(
      "현재 예약이 어려운",
    );
    expect(provider.plan).toHaveBeenCalledTimes(1);
  });
  it("provider failure returns fixed safe handoff with conservative reservation", async () => {
    const db = memoryClient();
    const provider = {
      plan: vi.fn().mockRejectedValue(new Error("SECRET_PROVIDER_ERROR")),
    };
    const response = await mockSkillHandler({
      environment: environment(),
      client: async () => db.client,
      provider,
    })(request());
    const text = await response.text();
    expect(text).toContain(HUMAN_HANDOFF);
    expect(text).not.toContain("SECRET_PROVIDER_ERROR");
    expect(db.state.consultations[0].status).toBe("UNCERTAIN");
    expect(db.state.quotas.every((x) => x.reservedCalls === 2)).toBe(true);
  });
  it("agent timeout aborts late provider before tools/settlement and returns before 4s", async () => {
    vi.useFakeTimers();
    const db = memoryClient();
    let resolve!: (value: unknown) => void;
    const provider = {
      plan: vi.fn((_input: unknown, signal: AbortSignal) => {
        expect(signal.aborted).toBe(false);
        void _input;
        return new Promise((r) => {
          resolve = r;
        });
      }),
    };
    const execute = vi.fn();
    const result = mockSkillHandler({
      environment: environment(),
      client: async () => db.client,
      provider: provider as never,
      tools: () => ({ execute }),
    })(request());
    await vi.advanceTimersByTimeAsync(2300);
    const response = await result;
    expect(await response.text()).toContain(HUMAN_HANDOFF);
    expect(db.state.consultations[0].status).toBe("PROCESSING");
    resolve({ name: "list_public_programs", args: {} });
    await vi.advanceTimersByTimeAsync(1);
    expect(execute).not.toHaveBeenCalled();
    expect(db.state.metrics).toHaveLength(0);
    expect(db.state.consultations[0].status).toBe("PROCESSING");
    expect(provider.plan.mock.calls[0]?.[1]?.aborted).toBe(true);
  });
  it("whole budget dominates each stage and clears timers", async () => {
    vi.useFakeTimers();
    let mono = 0;
    const budget = new Deadline(() => mono);
    await budget.stage("auth", async () => {
      mono = 3650;
      return true;
    });
    await expect(
      budget.stage("agent", async () => {
        mono = 3701;
        return true;
      }),
    ).rejects.toThrow();
    expect(budget.controller.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
