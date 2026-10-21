"use client";

import { ApplicationWizard, type PriceRecheck, type WizardAction } from "../../_components/application-wizard";
import type { WizardClass } from "@/lib/reservation-applications/application-draft";

/** Shared modern implementation for group, upgraded legacy address, and friend invitation. */
export function GroupApplicationForm({ action, classes, recheck }: { action: WizardAction; classes: WizardClass[]; recheck?: PriceRecheck }) {
  return <ApplicationWizard action={action} classes={classes} recheck={recheck} />;
}
