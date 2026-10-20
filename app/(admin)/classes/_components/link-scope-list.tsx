import type { ClassLinkScope } from "@/lib/reservation-applications/link-queries";
import { LinkReadiness, LINK_ISSUANCE_LABEL } from "./link-readiness";

export function LinkScopeList({ scopes }: { scopes: ClassLinkScope[] }) {
  return <div className="space-y-3" data-testid="link-scope-list">{scopes.length === 0 ? <p className="text-sm">발급 이력이 없습니다.</p> : scopes.map((scope) => <section className="min-w-0 rounded border p-3" key={scope.id}>
    <h3 className="break-words font-medium">{scope.label} · {LINK_ISSUANCE_LABEL[scope.readiness.issuance]}</h3>
    {scope.groupId ? <a className="break-all text-sm underline" href={`/reservation-applications/groups/${encodeURIComponent(scope.groupId)}`}>이 범위의 링크 관리</a> : null}
    <p className="text-sm">범위 {scope.scopeActive ? "활성" : "비활성"}</p>
    <ul className="my-2 space-y-1 text-sm">{scope.members.map((member) => <li className="break-words" key={member.id}>{member.label}</li>)}</ul>
    <details><summary className="min-h-11 cursor-pointer py-2">발급 이력·진단</summary>
      <ul className="space-y-2 text-sm">{scope.links.map((link) => <li className="break-words" key={link.id}>{link.isActive ? "링크 활성" : "링크 비활성"} · {link.issuedAtLabel} · {link.issuedByName}{link.isActive && !link.rawPath ? <p>주소 원문은 발급할 때만 확인할 수 있습니다.</p> : null}</li>)}</ul>
      <LinkReadiness readiness={scope.readiness} />
    </details>
  </section>)}</div>;
}
