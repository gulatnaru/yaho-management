export default function TeachersLoading() {
  return (
    <section className="space-y-6">
      <div className="h-8 w-32 animate-pulse rounded bg-slate-200" />
      <div className="h-10 w-full max-w-xl animate-pulse rounded bg-slate-200" />
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, index) => (
          <div className="h-12 w-full animate-pulse rounded bg-slate-100" key={index} />
        ))}
      </div>
    </section>
  );
}
