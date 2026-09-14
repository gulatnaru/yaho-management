"use server";

import { requireOperationalPrincipal } from "@/lib/auth/authorization";
import { getLatestInsurancePrefill } from "@/lib/classes/insurance-prefill";

export async function loadLatestInsurancePrefill(beforeClassId?: string) {
  await requireOperationalPrincipal();
  return getLatestInsurancePrefill(beforeClassId);
}
