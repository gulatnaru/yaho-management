import type { PrismaClient, AiConsultation } from "@prisma/client";
import {
  AiDenied,
  HUMAN_HANDOFF,
  PENDING,
  skillSchema,
  skillReply,
  type Scope,
} from "@/lib/ai-consultations/contracts";
import { type Keyring } from "@/lib/ai-consultations/crypto";
import { Deadline } from "./deadline";
import {
  AI_PROOF_HEADER,
  assertMockEnvironment,
  authorizeScope,
  readBoundedBody,
  verifyProof,
} from "./runtime";
import { claim, dispatch, readLimits, settle } from "./ledger";
import { mockProvider, runAgent, render, type MockProvider } from "./agent";
import { createTools, type Tools } from "./tools";
export type HandlerDependencies = {
  environment: NodeJS.ProcessEnv;
  client: () => Promise<PrismaClient>;
  clock?: () => Date;
  deadline?: () => Deadline;
  provider?: MockProvider;
  tools?: (client: PrismaClient, scope: Scope) => Tools;
};
export function mockSkillHandler(deps: HandlerDependencies) {
  return async (request: Request) => {
    const budget = deps.deadline?.() ?? new Deadline();
    const clock = deps.clock ?? (() => new Date());
    let row: AiConsultation | undefined;
    let client: PrismaClient | undefined;
    let scope: Scope | undefined;
    let keys: Keyring | undefined;
    let validatedQuestion = "";
    let providerStarted = false;
    try {
      // This check MUST precede body/auth/keys/client construction, including unit HTTP paths.
      assertMockEnvironment(deps.environment);
      const prepared = await budget.stage("auth", async (signal) => {
        const body = await readBoundedBody(request, signal);
        const parsed = skillSchema.parse(JSON.parse(body));
        const proof = verifyProof(
          request.headers.get(AI_PROOF_HEADER),
          body,
          "POST:/api/ai-consultations/mock-skill",
          deps.environment,
          clock(),
        );
        const limits = readLimits(deps.environment);
        const db = await deps.client();
        budget.assert();
        const owned = await authorizeScope(
          db,
          proof,
          deps.environment,
          clock(),
        );
        budget.assert();
        if (!owned.manifest.subjectIds.includes(parsed.userRequest.user.id))
          throw new AiDenied();
        return { parsed, proof, limits, db, owned };
      });
      ({ db: client, owned: scope } = prepared);
      keys = prepared.proof.keys;
      validatedQuestion = prepared.parsed.userRequest.utterance;
      const claimed = await budget.stage("claim", async (_signal, ms) =>
        claim(
          client!,
          scope!,
          prepared.parsed,
          keys!,
          prepared.limits,
          clock(),
          Math.max(50, ms - 100),
          new Date(clock().getTime() + budget.remaining() - 300),
        ),
      );
      if (claimed.kind === "CACHED") {
        const fresh = await budget.stage("agent", async (signal) => {
          const plan = await mockProvider.plan(
            {
              scenario: prepared.parsed.action.params.scenario,
              classHandle: scope!.manifest.classIds.length
                ? "class-1"
                : undefined,
            },
            signal,
          );
          if (!plan)
            return { category: "HUMAN_HANDOFF" as const, text: HUMAN_HANDOFF };
          const tools =
            deps.tools?.(client!, scope!) ??
            createTools(client!, scope!, clock);
          return render(await tools.execute(plan, signal));
        });
        return Response.json(skillReply(fresh), {
          headers: { "cache-control": "no-store" },
        });
      }
      if (claimed.kind === "PENDING")
        return Response.json(
          skillReply({ category: "HUMAN_HANDOFF", text: PENDING }),
          { headers: { "cache-control": "no-store" } },
        );
      row = claimed.row;
      const reply = await budget.stage("agent", async (signal) => {
        budget.assert();
        await dispatch(client!, scope!, row!, clock());
        budget.assert();
        providerStarted = true;
        const tools =
          deps.tools?.(client!, scope!) ?? createTools(client!, scope!, clock);
        return runAgent(
          {
            scenario: prepared.parsed.action.params.scenario,
            classHandle: scope!.manifest.classIds.length
              ? "class-1"
              : undefined,
          },
          tools,
          deps.provider ?? mockProvider,
          signal,
        );
      });
      const completed = await budget.stage("settle", async (_signal, ms) =>
        settle(
          client!,
          scope!,
          row!,
          keys!,
          {
            question: validatedQuestion,
            reply,
            usedCalls: 1,
            uncertain: false,
          },
          clock(),
          Math.max(50, ms - 100),
        ),
      );
      if (!completed) throw new AiDenied();
      budget.assert();
      return Response.json(skillReply(reply), {
        headers: { "cache-control": "no-store" },
      });
    } catch {
      // No write after deadline/abort. Claimed rows carry a recovery deadline even when commit result is uncertain.
      if (
        row &&
        client &&
        scope &&
        keys &&
        !budget.controller.signal.aborted &&
        budget.remaining() > 350
      ) {
        try {
          await budget.stage("settle", async (_signal, ms) =>
            settle(
              client!,
              scope!,
              row!,
              keys!,
              {
                question: validatedQuestion,
                usedCalls: 0,
                uncertain: providerStarted,
              },
              clock(),
              Math.max(50, ms - 100),
            ),
          );
        } catch {
          /* Persistent PROCESSING/UNCERTAIN state is recovered by the bounded ADMIN job. */
        }
      }
      return Response.json(
        skillReply({ category: "HUMAN_HANDOFF", text: HUMAN_HANDOFF }),
        { status: row ? 200 : 403, headers: { "cache-control": "no-store" } },
      );
    } finally {
      budget.abort();
    }
  };
}
