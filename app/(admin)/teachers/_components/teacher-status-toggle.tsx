"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { setTeacherActive } from "../actions";

export interface TeacherStatusToggleProps {
  id: string;
  isActive: boolean;
}

export function TeacherStatusToggle({ id, isActive }: TeacherStatusToggleProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const router = useRouter();

  function handleClick() {
    setError(undefined);
    startTransition(async () => {
      const result = await setTeacherActive(id, !isActive);
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
