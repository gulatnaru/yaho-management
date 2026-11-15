"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { pauseServiceAction, type PauseServiceState } from "../actions";

const INITIAL_STATE: PauseServiceState = null;

export function PauseServiceForm({ expectedVersion }: { expectedVersion: number }) {
    const [state, formAction, pending] = useActionState(pauseServiceAction, INITIAL_STATE);
    return <form action={formAction}>
        <input type="hidden" name="expectedVersion" value={expectedVersion} />
        <Button className="rounded bg-red-700 px-3 py-2 font-bold text-white hover:bg-red-800" disabled={pending}>긴급 중단</Button>
        {state && "formError" in state ? <p role="alert">{state.formError}</p> : null}
        {state && "paused" in state ? <p role="status">중단됨 · 버전 {state.version} · 이미 중단됨: {state.alreadyPaused ? "예" : "아니요"}</p> : null}
    </form>;
}
