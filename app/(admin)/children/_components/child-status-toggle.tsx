"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { setChildActive } from "../actions";

export interface ChildStatusToggleProps {
  id: string;
  isActive: boolean;
  buttonClassName?: string;
}

export function ChildStatusToggle({ id, isActive, buttonClassName }: ChildStatusToggleProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const router = useRouter();

  function handleClick() {
    setError(undefined);
    startTransition(async () => {
      const result = await setChildActive(id, !isActive);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        className={cn(buttonClassName)}
        disabled={pending}
        onClick={handleClick}
        type="button"
        variant="default"
      >
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
