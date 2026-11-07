import { describe, expect, it } from "vitest";
import { classDigest } from "@/server/ai-service/publication-digest";
import { syntheticContext } from "@/tests/eval/ai-service/synthetic";
import { now } from "./fake-db";

function seedCancelled(context: ReturnType<typeof syntheticContext>) {
    const program = { id: "source-forest", name: "합성 탐험숲", description: "합성 체험 안내", status: "ACTIVE", updatedAt: now };
    const schedule = { id: "source-class-cancelled", programId: program.id, startsAt: new Date("2026-10-17T01:00:00Z"),
        endsAt: new Date("2026-10-17T02:00:00Z"), location: "합성 숲 입구", status: "CANCELLED", updatedAt: now,
        program, capacity: 8, _count: { reservations: 0 } };
    context.fake.seed("classSchedule", schedule);
    context.fake.seed("aiServiceClassPublication", { id: "eval-class-cancelled", classScheduleId: schedule.id, environment: "PREVIEW", enabled: true,
        sourceUpdatedAt: now, sourceDigest: classDigest(schedule) });
}

describe("cancelled class availability (flow 5b)", () => {
    it("reports UNKNOWN for a CANCELLED class and excludes it from the public class list", async () => {
        const context = syntheticContext();
        seedCancelled(context);
        const signal = new AbortController().signal;
        const result = await context.tools.execute({ name: "get_class_availability", args: { classHandle: "eval-class-cancelled" } }, signal);
        expect(result).toEqual({ kind: "AVAILABILITY", status: "UNKNOWN" });
        const classes = await context.tools.execute({ name: "list_public_classes", args: { programHandle: null } }, signal);
        expect(classes.kind).toBe("CLASSES");
        if (classes.kind === "CLASSES") {
            expect(classes.items.map(c => c.handle)).not.toContain("eval-class-cancelled");
            expect(classes.items).toHaveLength(4);
        }
    });

    it("still reports the December class AVAILABLE after the cancelled seed", async () => {
        const context = syntheticContext();
        seedCancelled(context);
        const result = await context.tools.execute({ name: "get_class_availability", args: { classHandle: "eval-class-december" } }, new AbortController().signal);
        expect(result).toEqual({ kind: "AVAILABILITY", status: "AVAILABLE" });
    });
});
