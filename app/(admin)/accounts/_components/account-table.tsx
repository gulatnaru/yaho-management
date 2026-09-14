import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ACCOUNT_ROLE_LABELS } from "@/server/accounts/queries";

type AccountTableRow = {
  id: string;
  name: string;
  email: string;
  role: keyof typeof ACCOUNT_ROLE_LABELS;
  isActive: boolean;
  mustChangePassword: boolean;
  teacher: { id: string; name: string; isActive: boolean } | null;
};

export function AccountTable({ accounts }: { accounts: AccountTableRow[] }) {
  if (accounts.length === 0) {
    return <div className="rounded-lg border border-dashed p-10 text-center text-sm text-slate-500">등록된 계정이 없습니다.</div>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>이름</TableHead>
          <TableHead>이메일</TableHead>
          <TableHead>역할</TableHead>
          <TableHead>연결 선생님</TableHead>
          <TableHead>상태</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {accounts.map((account) => (
          <TableRow key={account.id}>
            <TableCell>
              <Link className="font-medium hover:underline" href={`/accounts/${account.id}`}>{account.name}</Link>
            </TableCell>
            <TableCell>{account.email}</TableCell>
            <TableCell>{ACCOUNT_ROLE_LABELS[account.role]}</TableCell>
            <TableCell>{account.teacher?.name ?? "–"}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant={account.isActive ? "success" : "secondary"}>{account.isActive ? "활성" : "비활성"}</Badge>
                {account.mustChangePassword ? <Badge variant="warning">비밀번호 변경 필요</Badge> : null}
                {account.teacher && !account.teacher.isActive ? <Badge variant="warning">연결 선생님 비활성</Badge> : null}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
