import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface PlaceholderSectionProps {
  title: string;
  description: string;
}

/**
 * ADR-011: 아이 상세 화면의 미구현 섹션 공용 컴포넌트.
 * 각 섹션의 실데이터 연결은 소유 Phase 착수 시 이 자리를 실제 조회 컴포넌트로 교체한다.
 */
export function PlaceholderSection({ title, description }: PlaceholderSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <CardDescription>{description}</CardDescription>
      </CardContent>
    </Card>
  );
}
