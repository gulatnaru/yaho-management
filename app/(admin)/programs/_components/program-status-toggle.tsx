"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { setProgramStatus } from "../actions";

export interface ProgramStatusToggleProps {
  id: string;
  status: "ACTIVE" | "INACTIVE";
}

export function ProgramStatusToggle({ id, status }: ProgramStatusToggleProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const router = useRouter();
  const isActive = status === "ACTIVE";

  function handleClick() {
    setError(undefined);
    startTransition(async () => {
      const result = await setProgramStatus(id, isActive ? "INACTIVE" : "ACTIVE");
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button disabled={pending} onClick={handleClick} type="button" variant="default">
        {pending ? "처리 중..." : isActive ? "비활성으로 전환" : "활성으로 전환"}
      </Button>
      {error ? (
        <p aria-live="polite" className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
