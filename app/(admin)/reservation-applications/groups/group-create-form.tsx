"use client";
import { useState } from "react";
import { IssuedLinkControls, MultiClassLinkComposer } from "@/app/(admin)/classes/_components/multi-class-link-composer";
import type { LinkCompositionOption } from "@/lib/reservation-applications/link-queries";
import type { ClassLinkReceipt } from "@/server/reservation-applications/groups";

export function GroupCreateForm({ classes, activeLinkIds }: { classes: LinkCompositionOption[]; activeLinkIds: string[] }) {
  const [receipt, setReceipt] = useState<ClassLinkReceipt>();
  const url = receipt?.token && receipt.linkId && activeLinkIds.includes(receipt.linkId) ? `${window.location.origin}/apply/group/${receipt.token}` : "";
  return <div className="space-y-3"><MultiClassLinkComposer onIssued={setReceipt} options={classes} />{url ? <IssuedLinkControls url={url} /> : null}</div>;
}
