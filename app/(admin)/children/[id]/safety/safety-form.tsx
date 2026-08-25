"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateChildSafetyInfo, type SafetyInfoFormState } from "@/lib/children/safety-info/actions";

type SafetyInfoValues = {
  allergies?: string | null;
  emergencyNotes?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelation?: string | null;
};

export function SafetyForm({ childId, values }: { childId: string; values: SafetyInfoValues | null }) {
  const [state, action, pending] = useActionState(updateChildSafetyInfo.bind(null, childId), {} as SafetyInfoFormState);
  return (
    <form action={action} className="max-w-xl space-y-5" noValidate>
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        응급 대응에 필요한 최소 정보만 기록해 주세요. 진단명·병력·복용약 이력은 저장하지 않습니다.
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="allergies">알레르기 및 주의사항</Label>
        <Textarea defaultValue={state.values?.allergies ?? values?.allergies ?? ""} id="allergies" name="allergies" />
        {state.errors?.allergies ? <p className="text-sm text-red-600">{state.errors.allergies[0]}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="emergencyNotes">응급 시 유의사항</Label>
        <Textarea defaultValue={state.values?.emergencyNotes ?? values?.emergencyNotes ?? ""} id="emergencyNotes" name="emergencyNotes" />
        {state.errors?.emergencyNotes ? <p className="text-sm text-red-600">{state.errors.emergencyNotes[0]}</p> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="emergencyContactName">비상연락처 이름</Label>
          <Input defaultValue={state.values?.emergencyContactName ?? values?.emergencyContactName ?? ""} id="emergencyContactName" name="emergencyContactName" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="emergencyContactRelation">관계</Label>
          <Input defaultValue={state.values?.emergencyContactRelation ?? values?.emergencyContactRelation ?? ""} id="emergencyContactRelation" name="emergencyContactRelation" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="emergencyContactPhone">비상연락처 전화번호</Label>
        <Input defaultValue={state.values?.emergencyContactPhone ?? values?.emergencyContactPhone ?? ""} id="emergencyContactPhone" name="emergencyContactPhone" type="tel" />
      </div>
      {state.formError ? <p className="text-sm text-red-600" role="alert">{state.formError}</p> : null}
      <Button disabled={pending} type="submit">{pending ? "저장 중..." : "안전 정보 저장"}</Button>
    </form>
  );
}
