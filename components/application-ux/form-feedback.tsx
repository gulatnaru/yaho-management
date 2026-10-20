export function FormFeedback({ error, notice }: { error?: string; notice?: string }) {
  return <>{error ? <p className="break-words text-sm text-red-700" role="alert">{error}</p> : null}{notice ? <p aria-live="polite" className="break-words text-sm text-emerald-700" role="status">{notice}</p> : null}</>;
}
