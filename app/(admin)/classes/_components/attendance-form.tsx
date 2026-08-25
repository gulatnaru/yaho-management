"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { recordAttendanceAction, type AttendanceFormState } from "../../reservations/attendance-actions";

export function AttendanceForm({ reservationId, current }: { reservationId: string; current?: "PRESENT" | "ABSENT" | null }) {
  const [state, action, pending] = useActionState(recordAttendanceAction, {} as AttendanceFormState);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="reservationId" type="hidden" value={reservationId} />
      <select className="rounded-md border bg-white px-2 py-1 text-xs" defaultValue={current ?? "PRESENT"} name="attendance">
        <option value="PRESENT">참석</option>
        <option value="ABSENT">불참</option>
      </select>
      <Button className="h-8 px-3 text-xs" disabled={pending} type="submit">{pending ? "저장..." : current ? "출결 정정" : "출결 기록"}</Button>
      {state.success ? <span className="text-xs text-emerald-700" role="status">저장됨</span> : null}
      {state.error ? <span className="text-xs text-red-600" role="alert">{state.error}</span> : null}
    </form>
  );
}
