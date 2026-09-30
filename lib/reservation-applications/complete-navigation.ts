/**
 * 공개 예약 신청 제출 성공 뒤의 이동(ADR-052). 클라이언트 컴포넌트에서 import 하므로 서버 전용 모듈을 쓰지 않는다.
 *
 * Server Action 의 redirect() 나 router.replace() 는 클라이언트 전환이라, 이전 신청 페이지의 RSC payload
 * (동의 문구·입력 흔적)가 완료 화면 문서에 그대로 남는다. 완료 화면은 문서를 통째로 새로 받는 이동으로 연다.
 */
export const APPLICATION_COMPLETE_PATH = "/apply/complete";

type ReplaceableLocation = Pick<Location, "replace">;

/**
 * 완료 화면으로 전체 문서 이동한다. replace 를 써서 뒤로 가기로 제출한 신청서 화면에 돌아가지 않게 한다.
 * @param location 테스트에서 바꿔 넣을 수 있게 받는다. 기본값은 브라우저의 window.location.
 */
export function openApplicationCompletePage(location: ReplaceableLocation = window.location): void {
  location.replace(APPLICATION_COMPLETE_PATH);
}

/**
 * 성공한 뒤에는 다시 제출하지 않는다. useActionState 는 제출을 차례로 처리하며 직전 상태를 넘겨주므로,
 * 직전 상태가 성공이면 서버를 부르지 않고 그 상태를 그대로 돌려준다(연타·Enter 중복 제출 방지).
 */
export function preventResubmitAfterSuccess<State extends { submitted?: boolean }, Payload>(
  action: (state: State, payload: Payload) => Promise<State>,
): (state: State, payload: Payload) => Promise<State> {
  return async (state, payload) => (state.submitted ? state : action(state, payload));
}
