"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db/prisma";
import { createPaymentCore, createRefundCore } from "@/lib/payments/core";
import {
  DuplicatePaymentError,
  NoShowRefundDetailRequiredError,
  PaymentItemNotFoundError,
  RefundAmountExceededError,
  ReservationNotFoundError,
} from "@/lib/payments/errors";
import { paymentInputSchema, refundInputSchema } from "@/lib/validation/payment";

export type PaymentFormValues = Partial<Record<"reservationId" | "amount" | "discountAmount" | "method" | "payerName" | "memo", string>>;
export type PaymentFormState = {
  errors?: Partial<Record<keyof PaymentFormValues, string[]>>;
  formError?: string;
  values?: PaymentFormValues;
};

function readPaymentValues(formData: FormData): PaymentFormValues {
  const value = (key: string) => {
    const raw = formData.get(key);
    return typeof raw === "string" ? raw : undefined;
  };
  return {
    reservationId: value("reservationId"),
    amount: value("amount"),
    discountAmount: value("discountAmount"),
    method: value("method"),
    payerName: value("payerName"),
    memo: value("memo"),
  };
}

export async function createPayment(
  _previousState: PaymentFormState,
  formData: FormData,
): Promise<PaymentFormState> {
  await requireAdmin();
  const values = readPaymentValues(formData);
  const parsed = paymentInputSchema.safeParse(values);
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors, values };

  let paymentId: string;
  try {
    const created = await createPaymentCore(prisma, parsed.data);
    paymentId = created.paymentId;
  } catch (error) {
    if (error instanceof DuplicatePaymentError) {
      return { formError: "이미 결제가 등록된 예약입니다.", values };
    }
    if (error instanceof ReservationNotFoundError) {
      return { formError: "예약을 찾을 수 없습니다.", values };
    }
    console.error("[payments] failed to create payment");
    return { formError: "결제 등록에 실패했습니다. 다시 시도해주세요.", values };
  }

  revalidatePath("/payments");
  revalidatePath(`/reservations/${parsed.data.reservationId}`);
  redirect(`/payments/${paymentId}`);
}

export type RefundFormValues = Partial<Record<"paymentItemId" | "amount" | "reason" | "reasonDetail", string>>;
export type RefundFormState = {
  errors?: Partial<Record<keyof RefundFormValues, string[]>>;
  formError?: string;
  values?: RefundFormValues;
};

function readRefundValues(formData: FormData): RefundFormValues {
  const value = (key: string) => {
    const raw = formData.get(key);
    return typeof raw === "string" ? raw : undefined;
  };
  return {
    paymentItemId: value("paymentItemId"),
    amount: value("amount"),
    reason: value("reason"),
    reasonDetail: value("reasonDetail"),
  };
}

export async function createRefund(
  _previousState: RefundFormState,
  formData: FormData,
): Promise<RefundFormState> {
  const session = await requireAdmin();
  const values = readRefundValues(formData);
  const parsed = refundInputSchema.safeParse(values);
  if (!parsed.success) return { errors: parsed.error.flatten().fieldErrors, values };

  let paymentId: string;
  try {
    const created = await createRefundCore(prisma, {
      ...parsed.data,
      processedById: session.user.id,
    });
    paymentId = created.paymentId;
  } catch (error) {
    if (error instanceof NoShowRefundDetailRequiredError) {
      return { errors: { reasonDetail: ["노쇼 환불은 상세 사유를 반드시 입력해주세요."] }, values };
    }
    if (error instanceof RefundAmountExceededError) {
      return { formError: "환불금액이 남은 환불 가능 금액을 초과합니다.", values };
    }
    if (error instanceof PaymentItemNotFoundError) {
      return { formError: "결제 항목을 찾을 수 없습니다.", values };
    }
    console.error("[payments] failed to create refund");
    return { formError: "환불 처리에 실패했습니다. 다시 시도해주세요.", values };
  }

  revalidatePath("/payments");
  revalidatePath(`/payments/${paymentId}`);
  revalidatePath("/reservations");
  redirect(`/payments/${paymentId}`);
}
