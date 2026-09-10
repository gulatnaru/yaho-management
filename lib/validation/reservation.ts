import { z } from "zod";

export const reservationInputSchema = z.object({
  classScheduleId: z.string().trim().min(1, "클래스를 선택해주세요"),
  childId: z.string().trim().min(1, "아이를 선택해주세요"),
  memo: z.string().optional(),
});

export type ReservationInput = z.infer<typeof reservationInputSchema>;

export const reservationSubmissionSchema = reservationInputSchema.extend({
  confirmOverbooking: z.enum(["true"]).optional(),
  confirmedClassScheduleId: z.string().trim().min(1).optional(),
  confirmedChildId: z.string().trim().min(1).optional(),
});

export type ReservationSubmission = z.infer<typeof reservationSubmissionSchema>;

// prisma/schema.prisma ReservationCancelReason enum 과 정확히 맞춘다.
export const cancelReservationInputSchema = z.object({
  cancelReason: z.enum(
    ["PERSONAL", "ILLNESS", "SCHEDULE", "WEATHER", "DUPLICATE", "OPERATION", "OTHER"],
    { errorMap: () => ({ message: "취소 사유를 선택해주세요" }) },
  ),
  cancelDetail: z.string().optional(),
});

export type CancelReservationInput = z.infer<typeof cancelReservationInputSchema>;
