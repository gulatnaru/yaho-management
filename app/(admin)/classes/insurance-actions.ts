"use server";

import { requireAdmin } from "@/lib/auth/authorization";
import { getLatestInsurancePrefill } from "@/lib/classes/insurance-prefill";

export async function loadLatestInsurancePrefill(beforeClassId?: string) {
  await requireAdmin();
  return getLatestInsurancePrefill(beforeClassId);
}
