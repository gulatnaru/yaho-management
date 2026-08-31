"use client";

export default function RevenueError({ reset }: { reset: () => void }) {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-bold">매출 집계를 불러오지 못했습니다.</h1>
      <button className="underline" onClick={reset} type="button">
        다시 시도
      </button>
    </section>
  );
}
