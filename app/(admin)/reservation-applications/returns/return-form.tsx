"use client";

import { recordApplicationReturn, type WorkflowActionResult } from "../actions";
import { BankTransactionForm } from "../submissions/[id]/deposit-form";
export function ReturnForm({ obligationId, remaining, amount, returnedAmount, disabled, verify }: {
  obligationId: string; remaining: number; amount: number; returnedAmount: number;
  disabled?: boolean; verify?: (result: WorkflowActionResult) => Promise<boolean>;
}) {
  return <BankTransactionForm kind="return" targetId={obligationId} remaining={remaining} observed={{ amount, returnedAmount }} disabled={disabled} save={(form) => recordApplicationReturn(obligationId, form)} verify={verify} />;
}
