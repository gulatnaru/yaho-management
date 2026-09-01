export default function DashboardLoading() {
  return (
    <section className="space-y-8" aria-label="대시보드 불러오는 중">
      <div className="h-8 w-36 animate-pulse rounded bg-slate-200" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <div className="h-24 animate-pulse rounded-lg bg-slate-200" key={index} />
        ))}
      </div>
      <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-[32rem] animate-pulse rounded-lg bg-slate-100" />
    </section>
  );
}
