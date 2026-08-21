import Link from "next/link";
import { ChildForm } from "../_components/child-form";

export default function NewChildPage() {
  return (
    <section className="space-y-6">
      <Link className="text-sm text-slate-500 hover:underline" href="/children">
        ← 목록으로
      </Link>

      <h1 className="text-2xl font-bold">아이 등록</h1>
      <ChildForm mode="create" />
    </section>
  );
}
