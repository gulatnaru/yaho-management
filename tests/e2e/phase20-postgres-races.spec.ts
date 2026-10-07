import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { assertPreviewE2eRunnerProof } from "@/lib/e2e/preview-runner";
import { phase20SyntheticMarker, registerPhase20OwnedChildren } from "@/lib/e2e/phase20-cleanup";
import { parseAndVerifySignedPreviewRun } from "@/lib/e2e/phase20-lease";
import { hashApplicationCapabilityToken } from "@/lib/reservation-applications/token";
import { closeApplicationWithReturnCore, confirmApplicationSubmissionCore, recordApplicationDepositCore, recordApplicationReturnCore } from "@/server/reservation-applications/finance";
import { createApplicationGroupCore, issueApplicationGroupLinkCore, issueCompanionInviteCore, submitApplicationGroupCore, updateApplicationGroupCore } from "@/server/reservation-applications/groups";
import { listOwnedRepeatChildrenCore, revokeApplicationDeviceCore } from "@/server/reservation-applications/devices";
import { purgeExpiredPersonalDataCore } from "@/server/reservation-applications/retention";
import { runPhase20PostgresRace, type Phase20RaceObserver, type Phase20RaceTransactionAdapter } from "./support/phase20-race-barrier";

const runId = process.env.YAHO_E2E_RUN_ID;
if (process.env.PLAYWRIGHT_PREVIEW_E2E !== "1" || !runId || !/^preview-[A-Za-z0-9_-]{22}$/.test(runId)) throw new Error("Phase20 PostgreSQL races require the guarded Preview runner");
assertPreviewE2eRunnerProof({ proofPath: process.env.PREVIEW_E2E_RUNNER_PROOF_PATH, proof: process.env.PREVIEW_E2E_RUNNER_PROOF });
const marker = phase20SyntheticMarker(runId); const DAY = 86_400_000; const TX = { maxWait: 10_000, timeout: 20_000 } as const;
const name = (suffix: string) => `${marker}${suffix}`;
function child(classScheduleId: string, value: string) { return { classScheduleId, childName: name(value), childBirthDate: "2020-01-01", childGender: "UNSPECIFIED" as const, programTerms: true as const, privacyConsent: true as const, legalGuardianConfirmation: true as const, refundTerms: true as const, photoShareConsent: false as const, photoMarketingConsent: false as const }; }

type Fixture = { adminId: string; groupId: string; token: string; classes: string[] };
async function fixture(db: PrismaClient, code: string, count = 1, capacity = 8): Promise<Fixture> {
  const admin = await db.user.findFirst({ where: { role: "ADMIN", isActive: true }, select: { id: true } }); if (!admin) throw new Error("missing admin fixture");
  const program = await db.program.create({ data: { name: name(`${code}p`), defaultPrice: 0 } }); const start = Date.now() + 14 * DAY;
  const classes = await Promise.all(Array.from({ length: count }, (_, i) => db.classSchedule.create({ data: { programId: program.id, startsAt: new Date(start + i * DAY), endsAt: new Date(start + i * DAY + 3_600_000), location: name(`${code}${i}`), capacity, applicationPrice: 10_000 }, select: { id: true } })));
  const group = await createApplicationGroupCore(db, { classScheduleIds: classes.map((x) => x.id), actorUserId: admin.id, now: new Date(), syntheticRunId: runId, syntheticSettings: { bankName: "테스트", accountNumber: "000000", accountHolder: "테스트", blogUrl: "https://example.test/a", instagramUrl: "https://example.test/b", kakaoChannelUrl: "https://example.test/c" } });
  const link = await issueApplicationGroupLinkCore(db, { groupId: group.groupId, actorUserId: admin.id, now: new Date() }); return { adminId: admin.id, groupId: group.groupId, token: link.token, classes: classes.map((x) => x.id) };
}
async function submit(db: PrismaClient, f: Fixture, code: string, classes = f.classes) { const raw = randomUUID(); const result = await submitApplicationGroupCore(db, { token: f.token, data: { guardianName: name(`${code}g`), guardianPhone: "010-0000-0000", guardianRelationship: "MOTHER", declaredPayerName: name(`${code}g`), children: classes.map((id, i) => child(id, `${code}${i}`)) }, consentVersion: "phase20-race", now: new Date(), configReady: true, completionTokenHash: hashApplicationCapabilityToken(randomUUID()), completionExpiresAt: new Date(Date.now() + 60_000), deviceTokenHash: hashApplicationCapabilityToken(raw), deviceExpiresAt: new Date(Date.now() + DAY) }); return { ...result, raw }; }
const choices = (ids: string[]) => ids.map((applicationId) => ({ applicationId, newChild: true }));
async function fund(db: PrismaClient, submissionId: string, adminId: string, amount: number, key: string) { return recordApplicationDepositCore(db, { submissionId, amount, payerName: name("payer0"), depositedAt: new Date(Date.now() - 1_000), idempotencyKey: name(key), actorUserId: adminId, now: new Date() }); }
async function race(observer: PrismaClient, a: PrismaClient, b: PrismaClient, target: string, left: (client: Phase20RaceTransactionAdapter) => Promise<unknown>, right: (client: Phase20RaceTransactionAdapter) => Promise<unknown>) {
  return runPhase20PostgresRace({ observer: observer as unknown as Phase20RaceObserver, a: a as unknown as Phase20RaceTransactionAdapter, b: b as unknown as Phase20RaceTransactionAdapter, target, left, right, transactionOptions: TX });
}

test.describe.serial("Phase 20 guarded PostgreSQL races", () => {
  test.setTimeout(180_000);
  test("two administrators confirm one funded sibling submission exactly once", async () => { const [db,a,b]=[new PrismaClient(),new PrismaClient(),new PrismaClient()]; try { const f=await fixture(db,"pgr001"); const s=await submit(db,f,"pgr001",[f.classes[0]!,f.classes[0]!]); await fund(db,s.submissionId,f.adminId,20_000,"dep001"); const r=await race(db,a,b,"ReservationApplicationSubmission",(c)=>confirmApplicationSubmissionCore(c as never,{submissionId:s.submissionId,choices:choices(s.applicationIds),actorUserId:f.adminId,now:new Date()}),(c)=>confirmApplicationSubmissionCore(c as never,{submissionId:s.submissionId,choices:choices(s.applicationIds),actorUserId:f.adminId,now:new Date()})); expect(r.filter(x=>x.status==="fulfilled")).toHaveLength(1); const [reservations,mappings,payment,allocations]=await Promise.all([db.reservation.count({where:{classScheduleId:f.classes[0],child:{name:{startsWith:name("pgr001")}}}}),db.reservationApplicationPaymentMapping.count({where:{applicationId:{in:s.applicationIds}}}),db.payment.findFirst({where:{items:{some:{reservationApplicationMapping:{applicationId:{in:s.applicationIds}}}}},select:{items:{select:{amount:true}}}}),db.fundAllocation.aggregate({where:{paymentMapping:{applicationId:{in:s.applicationIds}}},_sum:{amount:true}})]); expect([reservations,mappings,payment?.items.length,payment?.items.every((item)=>item.amount===10_000),allocations._sum.amount]).toEqual([2,2,2,true,20_000]); } finally { await Promise.all([db.$disconnect(),a.$disconnect(),b.$disconnect()]); } });
  test("last capacity permits one independently funded family", async () => { const [db,a,b]=[new PrismaClient(),new PrismaClient(),new PrismaClient()]; try { const f=await fixture(db,"pgr002",1,1); const x=await submit(db,f,"pgr002a"), y=await submit(db,f,"pgr002b"); await Promise.all([fund(db,x.submissionId,f.adminId,10_000,"dep002a"),fund(db,y.submissionId,f.adminId,10_000,"dep002b")]); const r=await race(db,a,b,"ClassSchedule",(c)=>confirmApplicationSubmissionCore(c as never,{submissionId:x.submissionId,choices:choices(x.applicationIds),actorUserId:f.adminId,now:new Date()}),(c)=>confirmApplicationSubmissionCore(c as never,{submissionId:y.submissionId,choices:choices(y.applicationIds),actorUserId:f.adminId,now:new Date()})); expect(r.filter(x=>x.status==="fulfilled")).toHaveLength(1); expect(await db.reservation.count({where:{classScheduleId:f.classes[0],status:"RESERVED"}})).toBe(1); } finally { await Promise.all([db.$disconnect(),a.$disconnect(),b.$disconnect()]); } });
  test("same deposit key remains one row before confirmation", async () => { const [db,a,b]=[new PrismaClient(),new PrismaClient(),new PrismaClient()]; try { const f=await fixture(db,"pgr003"),s=await submit(db,f,"pgr003"); const input={submissionId:s.submissionId,amount:10_000,payerName:name("payer3"),depositedAt:new Date(Date.now()-1_000),idempotencyKey:name("dep003"),actorUserId:f.adminId,now:new Date()}; const r=await race(db,a,b,"ReservationApplicationSubmission",(c)=>recordApplicationDepositCore(c as never,input),(c)=>recordApplicationDepositCore(c as never,input)); expect(r.filter(x=>x.status==="fulfilled")).toHaveLength(2); expect(await db.applicationDeposit.count({where:{submissionId:s.submissionId}})).toBe(1); expect(await db.payment.count({where:{items:{some:{reservationApplicationMapping:{applicationId:{in:s.applicationIds}}}}}})).toBe(0); } finally { await Promise.all([db.$disconnect(),a.$disconnect(),b.$disconnect()]); } });
  test("same return key is one funded full return", async () => { const [db,a,b]=[new PrismaClient(),new PrismaClient(),new PrismaClient()]; try { const f=await fixture(db,"pgr004"),s=await submit(db,f,"pgr004"); await fund(db,s.submissionId,f.adminId,10_000,"dep004"); await closeApplicationWithReturnCore(db,{applicationId:s.applicationIds[0]!,status:"REJECTED",resolutionNote:"synthetic",actorUserId:f.adminId,now:new Date()}); const o=await db.returnObligation.findFirstOrThrow({where:{submissionId:s.submissionId},select:{id:true}}); const input={obligationId:o.id,amount:10_000,reason:"synthetic",returnedAt:new Date(Date.now()-1_000),idempotencyKey:name("ret004"),actorUserId:f.adminId,now:new Date()}; const raceResult=await race(db,a,b,"ReservationApplicationSubmission",(c)=>recordApplicationReturnCore(c as never,input),(c)=>recordApplicationReturnCore(c as never,input)); expect(raceResult.every((row)=>row.status==="fulfilled")).toBe(true); const ids=(raceResult as PromiseFulfilledResult<{returnId:string}>[]).map((row)=>row.value.returnId); expect(ids[0]).toBe(ids[1]); const final=await db.returnObligation.findUniqueOrThrow({where:{id:o.id}}); expect(await db.applicationReturn.count({where:{returnObligationId:o.id}})).toBe(1); expect(final.returnedAmount).toBe(final.amount); } finally { await Promise.all([db.$disconnect(),a.$disconnect(),b.$disconnect()]); } });
  test("membership removal rejects concurrent submit for removed class", async () => { const [db,a,b]=[new PrismaClient(),new PrismaClient(),new PrismaClient()]; try { const f=await fixture(db,"pgr005",2); const now=new Date(); const r=await race(db,a,b,"ReservationApplicationGroup",(c)=>updateApplicationGroupCore(c as never,{groupId:f.groupId,classScheduleIds:[f.classes[0]!],now}),(c)=>submitApplicationGroupCore(c as never,{token:f.token,data:{guardianName:name("pgr005g"),guardianPhone:"010-0000-0000",guardianRelationship:"MOTHER",declaredPayerName:name("pgr005g"),children:[child(f.classes[1]!,"pgr005c")]},consentVersion:"phase20-race",now,configReady:true,completionTokenHash:hashApplicationCapabilityToken(randomUUID()),completionExpiresAt:new Date(Date.now()+60_000),deviceTokenHash:hashApplicationCapabilityToken(randomUUID()),deviceExpiresAt:new Date(Date.now()+DAY)})); expect(r[0]?.status).toBe("fulfilled"); expect(r[1]?.status).toBe("rejected"); expect(await db.reservationApplication.count({where:{classScheduleId:f.classes[1],childName:name("pgr005c")}})).toBe(0); } finally { await Promise.all([db.$disconnect(),a.$disconnect(),b.$disconnect()]); } });
  test("multi-child second identity failure rolls all writes back", async () => { const db=new PrismaClient(); try { const f=await fixture(db,"pgr006",2); const s=await submit(db,f,"pgr006"); const apps=await db.reservationApplication.findMany({where:{id:{in:s.applicationIds}},orderBy:{id:"asc"},select:{childName:true,childBirthDate:true,childGender:true}}); const last=apps.at(-1)!; await db.child.create({data:{name:last.childName!,birthDate:last.childBirthDate!,gender:last.childGender!,guardianName:name("pgr006g"),guardianPhone:"010-0000-0000"}}); await fund(db,s.submissionId,f.adminId,20_000,"dep006"); const snapshot=async()=>Promise.all([db.child.count({where:{name:{startsWith:name("pgr006")}}}),db.reservation.count({where:{classScheduleId:{in:f.classes}}}),db.childConsent.count({where:{reservationApplicationId:{in:s.applicationIds}}}),db.deviceChild.count({where:{device:{submissions:{some:{submissionId:s.submissionId}}}}}),db.reservationApplicationPaymentMapping.count({where:{applicationId:{in:s.applicationIds}}}),db.payment.count({where:{items:{some:{reservationApplicationMapping:{applicationId:{in:s.applicationIds}}}}}}),db.fundAllocation.count({where:{deposit:{submissionId:s.submissionId}}})]); const before=await snapshot(); await expect(confirmApplicationSubmissionCore(db,{submissionId:s.submissionId,choices:choices(s.applicationIds),actorUserId:f.adminId,now:new Date()})).rejects.toBeDefined(); expect(await snapshot()).toEqual(before); } finally { await db.$disconnect(); } });
  test("paid cancelled reservation rejects reactivation conversion", async () => { const db=new PrismaClient(); try { const f=await fixture(db,"pgr007"); const first=await submit(db,f,"pgr007"); await fund(db,first.submissionId,f.adminId,10_000,"dep007a"); const converted=await confirmApplicationSubmissionCore(db,{submissionId:first.submissionId,choices:choices(first.applicationIds),actorUserId:f.adminId,now:new Date()}); await db.reservation.update({where:{id:converted.reservationIds[0]!},data:{status:"CANCELLED"}}); const childId=(await db.reservationApplication.findUniqueOrThrow({where:{id:first.applicationIds[0]!},select:{childId:true}})).childId!; const before=await Promise.all([db.paymentItem.findFirstOrThrow({where:{reservationId:converted.reservationIds[0]!},select:{amount:true,paidAmount:true,refundedAmount:true,payment:{select:{status:true,totalAmount:true}}}}),db.refund.aggregate({where:{paymentItem:{reservationId:converted.reservationIds[0]!}},_sum:{amount:true}}),db.reservation.findUniqueOrThrow({where:{id:converted.reservationIds[0]!},select:{status:true}})]); const second=await submit(db,f,"pgr007"); await fund(db,second.submissionId,f.adminId,10_000,"dep007b"); await expect(confirmApplicationSubmissionCore(db,{submissionId:second.submissionId,choices:[{applicationId:second.applicationIds[0]!,childId}],actorUserId:f.adminId,now:new Date()})).rejects.toBeDefined(); const after=await Promise.all([db.paymentItem.findFirstOrThrow({where:{reservationId:converted.reservationIds[0]!},select:{amount:true,paidAmount:true,refundedAmount:true,payment:{select:{status:true,totalAmount:true}}}}),db.refund.aggregate({where:{paymentItem:{reservationId:converted.reservationIds[0]!}},_sum:{amount:true}}),db.reservation.findUniqueOrThrow({where:{id:converted.reservationIds[0]!},select:{status:true}})]); expect(after).toEqual(before); expect(await db.reservationApplicationPaymentMapping.count({where:{applicationId:second.applicationIds[0]!}})).toBe(0); } finally { await db.$disconnect(); } });
  test("same new identity across classes creates one conversion", async () => { const [db,a,b]=[new PrismaClient(),new PrismaClient(),new PrismaClient()]; try { const f=await fixture(db,"pgr008",2),x=await submit(db,f,"pgr008",[f.classes[0]!]),y=await submit(db,f,"pgr008",[f.classes[1]!]); await Promise.all([fund(db,x.submissionId,f.adminId,10_000,"dep008a"),fund(db,y.submissionId,f.adminId,10_000,"dep008b")]); const ids=[...x.applicationIds,...y.applicationIds]; const r=await race(db,a,b,"pg_advisory_xact_lock",(c)=>confirmApplicationSubmissionCore(c as never,{submissionId:x.submissionId,choices:choices(x.applicationIds),actorUserId:f.adminId,now:new Date()}),(c)=>confirmApplicationSubmissionCore(c as never,{submissionId:y.submissionId,choices:choices(y.applicationIds),actorUserId:f.adminId,now:new Date()})); expect(r.filter(x=>x.status==="fulfilled")).toHaveLength(1); const [children,reservations,maps,payment,allocation,loser]=await Promise.all([db.child.count({where:{name:name("pgr0080")}}),db.reservation.count({where:{child:{name:name("pgr0080")}}}),db.reservationApplicationPaymentMapping.count({where:{applicationId:{in:ids}}}),db.payment.findFirst({where:{items:{some:{reservationApplicationMapping:{applicationId:{in:ids}}}}},select:{totalAmount:true}}),db.fundAllocation.aggregate({where:{paymentMapping:{applicationId:{in:ids}}},_sum:{amount:true}}),db.reservationApplication.count({where:{id:{in:ids},status:"SUBMITTED"}})]); expect([children,reservations,maps,payment?.totalAmount,allocation._sum.amount,loser]).toEqual([1,1,1,10_000,10_000,1]); } finally { await Promise.all([db.$disconnect(),a.$disconnect(),b.$disconnect()]); } });
  test("device revocation blocks concurrent verified repeat use", async () => {
    const [db, a, b] = [new PrismaClient(), new PrismaClient(), new PrismaClient()];
    try {
      const f = await fixture(db, "pgr009");
      const initial = await submit(db, f, "pgr009");
      await fund(db, initial.submissionId, f.adminId, 10_000, "dep009");
      await confirmApplicationSubmissionCore(db, { submissionId: initial.submissionId, choices: choices(initial.applicationIds), actorUserId: f.adminId, now: new Date() });
      const childId = (await db.reservationApplication.findUniqueOrThrow({ where: { id: initial.applicationIds[0]! }, select: { childId: true } })).childId!;
      const before = await db.reservationApplicationSubmission.count({ where: { groupId: f.groupId } });
      const result = await race(db, a, b, "ApplicationDevice",
        (client) => client.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "ApplicationDevice" WHERE "tokenHash" = ${hashApplicationCapabilityToken(initial.raw)} FOR UPDATE`;
          return revokeApplicationDeviceCore(tx as never, { token: initial.raw, now: new Date() });
        }),
        (client) => submitApplicationGroupCore(client as never, {
          token: f.token, previousDeviceTokenHash: hashApplicationCapabilityToken(initial.raw),
          data: { guardianName: name("pgr009g"), guardianPhone: "010-0000-0000", guardianRelationship: "MOTHER", declaredPayerName: name("pgr009g"), children: [{ ...child(f.classes[0]!, "pgr0090"), requestedChildId: childId }] },
          consentVersion: "phase20-race", now: new Date(), configReady: true,
          completionTokenHash: hashApplicationCapabilityToken(randomUUID()), completionExpiresAt: new Date(Date.now() + 60_000),
          deviceTokenHash: hashApplicationCapabilityToken(randomUUID()), deviceExpiresAt: new Date(Date.now() + DAY),
        }),
      );
      expect(result.map((row) => row.status)).toEqual(["fulfilled", "rejected"]);
      expect(await db.reservationApplicationSubmission.count({ where: { groupId: f.groupId } })).toBe(before);
      expect((await listOwnedRepeatChildrenCore(db, { token: initial.raw, now: new Date() })).children).toHaveLength(0);
    } finally { await Promise.all([db.$disconnect(), a.$disconnect(), b.$disconnect()]); }
  });
  test("identity edit blocks concurrent existing-child confirmation", async () => {
    const [db, a, b] = [new PrismaClient(), new PrismaClient(), new PrismaClient()];
    try {
      const f = await fixture(db, "pgr010");
      const existing = await db.child.create({ data: { name: name("pgr0100"), birthDate: new Date("2020-01-01"), gender: "UNSPECIFIED", guardianName: name("pgr010g"), guardianPhone: "010-0000-0000" } });
      const s = await submit(db, f, "pgr010"); await fund(db, s.submissionId, f.adminId, 10_000, "dep010");
      const result = await race(db, a, b, "Child",
        (client) => client.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "Child" WHERE "id" = ${existing.id} FOR UPDATE`;
          await (tx as unknown as Prisma.TransactionClient).child.update({ where: { id: existing.id }, data: { guardianName: name("pgr010x") } });
        }),
        (client) => confirmApplicationSubmissionCore(client as never, { submissionId: s.submissionId, choices: [{ applicationId: s.applicationIds[0]!, childId: existing.id }], actorUserId: f.adminId, now: new Date() }),
      );
      expect(result.map((row) => row.status)).toEqual(["fulfilled", "rejected"]);
      const [reservations, payments, mappings, consents] = await Promise.all([
        db.reservation.count({ where: { classScheduleId: f.classes[0]!, childId: existing.id } }),
        db.payment.count({ where: { items: { some: { reservationApplicationMapping: { applicationId: s.applicationIds[0]! } } } } }),
        db.reservationApplicationPaymentMapping.count({ where: { applicationId: s.applicationIds[0]! } }),
        db.childConsent.count({ where: { reservationApplicationId: s.applicationIds[0]! } }),
      ]);
      expect([reservations, payments, mappings, consents]).toEqual([0, 0, 0, 0]);
    } finally { await Promise.all([db.$disconnect(), a.$disconnect(), b.$disconnect()]); }
  });
  test("scoped purge tombstones a requested child before concurrent confirmation", async () => {
    const [db, a, b] = [new PrismaClient(), new PrismaClient(), new PrismaClient()];
    try {
      const f = await fixture(db, "pgr011", 2);
      const initial = await submit(db, f, "pgr011", [f.classes[0]!]);
      await fund(db, initial.submissionId, f.adminId, 10_000, "dep011a");
      const converted = await confirmApplicationSubmissionCore(db, { submissionId: initial.submissionId, choices: choices(initial.applicationIds), actorUserId: f.adminId, now: new Date() });
      const childId = (await db.reservationApplication.findUniqueOrThrow({ where: { id: initial.applicationIds[0]! }, select: { childId: true } })).childId!;
      const oldStart = new Date(Date.now() - 6 * 365 * DAY);
      await db.classSchedule.update({ where: { id: f.classes[0]! }, data: { startsAt: oldStart, endsAt: new Date(oldStart.getTime() + 3_600_000) } });
      await db.reservation.update({ where: { id: converted.reservationIds[0]! }, data: { status: "COMPLETED" } });
      const guardEnvironment = { ...process.env, VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_SHA: process.env.PREVIEW_E2E_DEPLOYMENT_SHA };
      const signed = parseAndVerifySignedPreviewRun(process.env.PREVIEW_E2E_PHASE20_SIGNED_RUN ?? null, guardEnvironment);
      if (!signed) throw new Error("Preview signed run is unavailable");
      await registerPhase20OwnedChildren(db, { runId, childIds: [childId], signed, now: new Date(), environment: guardEnvironment });
      const pendingRaw = randomUUID();
      const pending = await submitApplicationGroupCore(db, {
        token: f.token, previousDeviceTokenHash: hashApplicationCapabilityToken(initial.raw),
        data: { guardianName: name("pgr011g"), guardianPhone: "010-0000-0000", guardianRelationship: "MOTHER", declaredPayerName: name("pgr011g"), children: [{ ...child(f.classes[1]!, "pgr0110"), requestedChildId: childId }] },
        consentVersion: "phase20-race", now: new Date(), configReady: true,
        completionTokenHash: hashApplicationCapabilityToken(randomUUID()), completionExpiresAt: new Date(Date.now() + 60_000),
        deviceTokenHash: hashApplicationCapabilityToken(pendingRaw), deviceExpiresAt: new Date(Date.now() + DAY),
      });
      await fund(db, pending.submissionId, f.adminId, 10_000, "dep011b");
      const before = await Promise.all([
        db.paymentItem.count({ where: { reservationId: converted.reservationIds[0]! } }),
        db.fundAllocation.count({ where: { deposit: { submissionId: initial.submissionId } } }),
      ]);
      const result = await race(db, a, b, "ReservationApplicationSubmission",
        (client) => purgeExpiredPersonalDataCore(client as never, { actorUserId: f.adminId, now: new Date(), scope: { childIds: [childId], applicationIds: [] } }),
        (client) => confirmApplicationSubmissionCore(client as never, { submissionId: pending.submissionId, choices: [{ applicationId: pending.applicationIds[0]!, childId }], actorUserId: f.adminId, now: new Date() }),
      );
      expect(result.map((row) => row.status)).toEqual(["fulfilled", "rejected"]);
      const [purged, requested, deviceChildren, futureReservations, mappings, after] = await Promise.all([
        db.child.findUniqueOrThrow({ where: { id: childId }, select: { isActive: true, personalDataPurgedAt: true } }),
        db.reservationApplication.findUniqueOrThrow({ where: { id: pending.applicationIds[0]! }, select: { requestedChildId: true, requestedChildPurgedAt: true } }),
        db.deviceChild.count({ where: { childId } }),
        db.reservation.count({ where: { childId, classScheduleId: f.classes[1]!, status: "RESERVED" } }),
        db.reservationApplicationPaymentMapping.count({ where: { applicationId: pending.applicationIds[0]! } }),
        Promise.all([db.paymentItem.count({ where: { reservationId: converted.reservationIds[0]! } }), db.fundAllocation.count({ where: { deposit: { submissionId: initial.submissionId } } })]),
      ]);
      expect([purged.isActive, purged.personalDataPurgedAt === null, requested.requestedChildId, requested.requestedChildPurgedAt === null, deviceChildren, futureReservations, mappings]).toEqual([false, false, null, false, 0, 0, 0]);
      expect(after).toEqual(before);
    } finally { await Promise.all([db.$disconnect(), a.$disconnect(), b.$disconnect()]); }
  });
  test("closing the last pending issuer blocks a concurrent companion invite", async () => {
    const [db, a, b] = [new PrismaClient(), new PrismaClient(), new PrismaClient()];
    try {
      const f = await fixture(db, "pgr012");
      const s = await submit(db, f, "pgr012");
      const result = await race(db, a, b, "ReservationApplicationSubmission",
        (client) => closeApplicationWithReturnCore(client as never, { applicationId: s.applicationIds[0]!, status: "REJECTED", resolutionNote: "synthetic", actorUserId: f.adminId, now: new Date() }),
        (client) => issueCompanionInviteCore(client as never, { submissionId: s.submissionId, now: new Date(), classEndsAt: new Date(Date.now() + 10 * DAY), generateToken: () => randomUUID().replaceAll("-", "") }),
      );
      expect(result.map((row) => row.status)).toEqual(["fulfilled", "rejected"]);
      expect(await db.companionInvite.count({ where: { issuerSubmissionId: s.submissionId } })).toBe(0);
    } finally { await Promise.all([db.$disconnect(), a.$disconnect(), b.$disconnect()]); }
  });
});
