import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatKstDate, formatKstTime } from "@/lib/classes/datetime";
import { formatKrw } from "@/lib/payments/format";

type PaymentRow = {
  id: string;
  status: "PAID" | "PARTIAL_REFUNDED" | "REFUNDED" | "CANCELLED";
  paidAt: Date;
  totalAmount: number;
  items: Array<{ reservation: { child: { name: string }; classSchedule: { program: { name: string } } } }>;
};

const STATUS_LABEL = { PAID: "결제완료", PARTIAL_REFUNDED: "부분환불", REFUNDED: "전액환불", CANCELLED: "취소" } as const;

export function PaymentTable({ payments }: { payments: PaymentRow[] }) {
  return <Table><TableHeader><TableRow><TableHead>아이</TableHead><TableHead className="hidden md:table-cell">클래스</TableHead><TableHead>금액</TableHead><TableHead>상태</TableHead><TableHead className="hidden md:table-cell">결제일시</TableHead></TableRow></TableHeader><TableBody>{payments.map((payment) => { const item = payment.items[0]; return <TableRow key={payment.id}><TableCell><Link className="font-medium hover:underline" href={`/payments/${payment.id}`}>{item?.reservation.child.name ?? "-"}</Link></TableCell><TableCell className="hidden md:table-cell">{item?.reservation.classSchedule.program.name ?? "-"}</TableCell><TableCell>{formatKrw(payment.totalAmount)}</TableCell><TableCell><Badge variant={payment.status === "PAID" ? "default" : payment.status === "REFUNDED" ? "secondary" : "warning"}>{STATUS_LABEL[payment.status]}</Badge></TableCell><TableCell className="hidden md:table-cell">{formatKstDate(payment.paidAt)} {formatKstTime(payment.paidAt)}</TableCell></TableRow>; })}</TableBody></Table>;
}
