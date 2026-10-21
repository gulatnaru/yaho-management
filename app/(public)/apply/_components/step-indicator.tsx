import { APPLICATION_STEPS } from "@/lib/reservation-applications/application-draft";
export function StepIndicator({ step }: { step: number }) {
  return <nav aria-label="신청 입력 단계"><p aria-live="polite" className="font-semibold">3단계 중 {step}단계 · {APPLICATION_STEPS[step - 1]}</p><ol className="mt-2 grid gap-1 text-sm sm:grid-cols-3">{APPLICATION_STEPS.map((label, index) => <li aria-current={index + 1 === step ? "step" : undefined} key={label}>{index + 1}. {label}{index + 1 === step ? " — 현재" : index + 1 < step ? " — 입력 완료" : ""}</li>)}</ol></nav>;
}
