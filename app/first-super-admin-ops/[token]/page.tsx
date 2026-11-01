import { notFound } from "next/navigation";
import { firstSuperAdminOpsPageAvailable } from "@/server/accounts/first-super-admin-ops-gate";
import { getOpsAcceptanceState } from "@/server/accounts/first-super-admin-ops";
import { acceptAction } from "./actions";
export const dynamic = "force-dynamic";
export default async function FirstSuperAdminOpsAcceptance({ params }: { params: Promise<{ token: string }> }) {
  if (!await firstSuperAdminOpsPageAvailable()) notFound();
  const { token } = await params;
  const valid = await getOpsAcceptanceState(token);
  return <main><h1>최초 최고관리자 등록 수락</h1>{valid ? <form action={acceptAction.bind(null, token)}><p>토큰 소지 확인은 대면 실명 확인을 대신하지 않습니다.</p><label>비밀번호 <input type="password" name="password" minLength={8} maxLength={128} required /></label><label>비밀번호 확인 <input type="password" name="confirmPassword" minLength={8} maxLength={128} required /></label><button>수락</button></form> : <p>유효하지 않은 링크입니다.</p>}</main>;
}
