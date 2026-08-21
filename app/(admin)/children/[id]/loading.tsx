export default function ChildDetailLoading() {
  return (
    <section className="space-y-6">
      <div className="h-8 w-48 animate-pulse rounded bg-slate-200" />
      <div className="h-40 w-full animate-pulse rounded bg-slate-100" />
      <div className="h-24 w-full animate-pulse rounded bg-slate-100" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="h-24 animate-pulse rounded bg-slate-100" key={index} />
        ))}
      </div>
    </section>
  );
}
