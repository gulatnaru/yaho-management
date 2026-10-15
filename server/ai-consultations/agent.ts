import {
  AiDenied,
  HUMAN_HANDOFF,
  type Scenario,
  type Reply,
} from "@/lib/ai-consultations/contracts";
import {
  toolCallSchema,
  type ToolCall,
  type Tools,
  type ToolResult,
} from "./tools";
export type MockProvider = {
  plan: (
    input: {
      scenario: Scenario;
      classHandle?: string;
    },
    signal: AbortSignal,
  ) => Promise<ToolCall | null>;
};
/** No external SDK/transport. Provider receives only fixed synthetic intent, never raw user identity/history. */
export const mockProvider: MockProvider = {
  async plan({ scenario, classHandle }, signal): Promise<ToolCall | null> {
    if (signal.aborted) throw new AiDenied();
    switch (scenario) {
      case "PROGRAMS":
        return { name: "list_public_programs", args: {} };
      case "CLASSES":
        return { name: "list_public_classes", args: {} };
      case "AVAILABILITY":
        return classHandle
          ? { name: "get_class_availability", args: { classHandle } }
          : null;
      case "RAIN":
      case "POLICY":
      case "PREPARATION":
        return { name: "get_approved_guidance", args: { topic: scenario } };
      default:
        return null;
    }
  },
};
export function render(result: ToolResult): Reply {
  switch (result.kind) {
    case "PROGRAMS":
      return result.items.length
        ? {
            category: "PROGRAMS",
            text: result.items
              .map((x) => x.name + (x.description ? " — " + x.description : ""))
              .join("\n"),
          }
        : { category: "HUMAN_HANDOFF", text: HUMAN_HANDOFF };
    case "CLASSES":
      return result.items.length
        ? {
            category: "CLASSES",
            text: result.items
              .map(
                (x) =>
                  new Date(x.startsAt).toLocaleString("ko-KR", {
                    timeZone: "Asia/Seoul",
                  }) +
                  " " +
                  x.location,
              )
              .join("\n"),
          }
        : { category: "HUMAN_HANDOFF", text: HUMAN_HANDOFF };
    case "AVAILABILITY":
      return result.status === "UNKNOWN"
        ? { category: "HUMAN_HANDOFF", text: HUMAN_HANDOFF }
        : {
            category: "AVAILABILITY",
            text:
              result.status === "AVAILABLE"
                ? "현재 예약 가능한 일정입니다. 조회 시점의 안내이며 자리 보장이나 예약 확정이 아닙니다."
                : "현재 예약이 어려운 일정입니다. 담당자에게 문의해 주세요.",
          };
    case "GUIDANCE":
      return result.content
        ? { category: "GUIDANCE", text: result.content }
        : { category: "HUMAN_HANDOFF", text: HUMAN_HANDOFF };
  }
}
export async function runAgent(
  input: {
    scenario: Scenario;
    classHandle?: string;
  },
  tools: Tools,
  provider: MockProvider,
  signal: AbortSignal,
): Promise<Reply> {
  if (signal.aborted) throw new AiDenied();
  const planned = await provider.plan(input, signal);
  if (signal.aborted) throw new AiDenied();
  if (!planned) return { category: "HUMAN_HANDOFF", text: HUMAN_HANDOFF };
  const call = toolCallSchema.parse(planned);
  // Fixed intent-to-tool mapping prevents even a replaced mock provider from broadening its authority.
  const expected = await mockProvider.plan(input, signal);
  if (JSON.stringify(call) !== JSON.stringify(expected)) throw new AiDenied();
  await tools.execute(call, signal);
  if (signal.aborted) throw new AiDenied();
  // Re-read immediately before rendering. Publication revocation/availability changes cannot reuse earlier facts.
  const final = await tools.execute(call, signal);
  if (signal.aborted) throw new AiDenied();
  return render(final);
}
