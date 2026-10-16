"use client";
export default function ErrorPage({ reset }: {
    reset: () => void;
}) { return <section className="p-6"><p role="alert">상담 관리 화면을 불러올 수 없습니다.</p><button className="mt-3 rounded border p-2" onClick={reset}>다시 시도</button></section>; }
