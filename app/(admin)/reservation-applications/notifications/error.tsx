"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <section><p>알림 이력을 불러오지 못했습니다.</p><button onClick={reset}>다시 시도</button></section>; }
