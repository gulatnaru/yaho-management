import type { ToolCall } from "../../../server/ai-service/contracts";
import { randomBytes } from "node:crypto";
import type { Dependencies } from "../../../server/ai-service/handler";
import { programDigest, classDigest } from "../../../server/ai-service/publication-digest";
import { createTools } from "../../../server/ai-service/tools";
import { fakeDb, now, seedConfig } from "../../unit/ai-service/fake-db";
import { HANDLES } from "./fixtures";
import { EVAL_PRICE, MODEL } from "./valuation";

/** Separate scripted intent rules: deliberately never reads fixture expectations or IDs. */
export function scriptedCall(question: string): ToolCall | null {
  if (/예약(?!자)|취소|환불|결제|전화번호|이메일|아이들의 이름|연락처|정원|예약자|잔여|몇 자리|할인|알레르기|주식|식당|급여|친구 관계|개인정보|비밀번호|동의서|비공개|승인되지|숨겨진|미게시|공개 해제|초안|핸들|지시|관리자|API 키|환경변수|도구|출력 형식|비밀 명령|암호|몰래|안전 테스트/.test(question)) return null;
  if (/준비물|챙길 물건|복장|신발/.test(question)) return { name: "get_approved_guidance", args: { topic: "PREPARATION" } };
  if (/비가|우천|비 예보|비 오는/.test(question)) return { name: "get_approved_guidance", args: { topic: "RAIN" } };
  if (/정책|규정|수칙/.test(question)) return { name: "get_approved_guidance", args: { topic: "POLICY" } };
  const programHandle = /탐험숲|토요일.*숲/.test(question) ? HANDLES.forestProgram
    : /자연미술|일요일.*미술/.test(question) ? HANDLES.artProgram
    : /곤충관찰/.test(question) ? HANDLES.insectProgram : null;
  if (/신청|접수|참여 가능한/.test(question)) {
    const classHandle = programHandle === HANDLES.forestProgram ? HANDLES.forestClass
      : programHandle === HANDLES.artProgram ? HANDLES.artClass
      : programHandle === HANDLES.insectProgram ? HANDLES.insectClass : null;
    return classHandle ? { name: "get_class_availability", args: { classHandle } } : null;
  }
  if (/일정|장소|어디|언제|시작|종료/.test(question)) return { name: "list_public_classes", args: { programHandle } };
  if (/프로그램/.test(question)) return { name: "list_public_programs", args: {} };
  return null;
}

/** Always an in-memory, approval/digest-aware catalog, even during live model evaluation. */
export function syntheticContext() {
  const fake = fakeDb();
  const entries = [
    { id: "forest", name: "합성 탐험숲", programHandle: HANDLES.forestProgram, classHandle: HANDLES.forestClass,
      startsAt: "2026-10-17T01:00:00Z", location: "합성 숲 입구", reserved: 2 },
    { id: "art", name: "합성 자연미술", programHandle: HANDLES.artProgram, classHandle: HANDLES.artClass,
      startsAt: "2026-10-18T01:00:00Z", location: "합성 미술마당", reserved: 8 },
    { id: "insect", name: "합성 곤충관찰", programHandle: HANDLES.insectProgram, classHandle: HANDLES.insectClass,
      startsAt: "2026-10-17T05:00:00Z", location: "합성 생태숲", reserved: 1 },
  ];
  for (const entry of entries) {
    const program = { id: "source-" + entry.id, name: entry.name, description: "합성 체험 안내", status: "ACTIVE", updatedAt: now };
    const schedule = { id: "source-class-" + entry.id, programId: program.id, startsAt: new Date(entry.startsAt),
      endsAt: new Date(+new Date(entry.startsAt) + 3600000), location: entry.location, status: "SCHEDULED", updatedAt: now,
      program, capacity: 8, _count: { reservations: entry.reserved } };
    fake.seed("program", program);
    fake.seed("classSchedule", schedule);
    fake.seed("aiServiceProgramPublication", { id: entry.programHandle, programId: program.id, environment: "PREVIEW", enabled: true,
      sourceUpdatedAt: now, sourceDigest: programDigest(program) });
    fake.seed("aiServiceClassPublication", { id: entry.classHandle, classScheduleId: schedule.id, environment: "PREVIEW", enabled: true,
      sourceUpdatedAt: now, sourceDigest: classDigest(schedule) });
  }
  for (const [topic, content] of [
    ["PREPARATION", "합성 안내: 움직이기 편한 복장과 신발을 준비해 주세요."],
    ["RAIN", "합성 안내: 우천 시 운영 여부는 담당자에게 확인해 주세요."],
    ["POLICY", "합성 안내: 현장 안전 수칙을 따라 주세요."],
  ]) fake.seed("aiServiceKnowledgeEntry", { environment: "PREVIEW", topic, content, approved: true });
  return { fake, tools: createTools(fake.db, "PREVIEW", () => now) };
}

/** A fresh ledger per question prevents synthetic quota/replay state from biasing intent scores. */
export function syntheticHandlerDependencies(context: ReturnType<typeof syntheticContext>, provider: Dependencies["provider"]): Dependencies {
  seedConfig(context.fake);
  Object.assign(context.fake.state.aiServiceConfig[0], {
    ...EVAL_PRICE, fxCheckedAt: now, model: MODEL,
  });
  return {
    db: context.fake.db, environment: "PREVIEW", provider, tools: context.tools, clock: () => now,
    secret: "synthetic-evaluation-handler-secret-0123456789", botId: "synthetic-eval-bot",
    keys: { encryption: { v1: randomBytes(32) }, hmac: { v1: randomBytes(32) }, activeEncryption: "v1", activeHmac: "v1" },
  };
}
