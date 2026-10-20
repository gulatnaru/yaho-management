"use client";
import { useEffect } from "react";
/** Only the server-validated application ID crosses this client boundary. */
export function ApplicationReviewFocus({ applicationId }: { applicationId: string | null }) {
  useEffect(() => {
    if (!applicationId) return;
    const section = document.getElementById(`application-${applicationId}`);
    section?.focus({ preventScroll: true });
    section?.scrollIntoView({ block: "start" });
  }, [applicationId]);
  return null;
}
