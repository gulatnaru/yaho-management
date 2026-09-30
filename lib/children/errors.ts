/**
 * 보관기간 만료로 개인정보를 비식별화한 아이(Child.personalDataPurgedAt 이 있음)에게 예약·동의·안전정보 같은
 * 개인정보를 새로 쓰려고 할 때 던진다(ADR-058). 없는 아이(ChildNotFoundError)·비활성 아이(ChildNotActiveError)와
 * 구분해서 사용자에게 "다시 활성화" 같은 잘못된 안내를 하지 않게 한다.
 */
export class ChildPersonalDataPurgedError extends Error {
  constructor() {
    super("Child personal data has been purged");
    this.name = "ChildPersonalDataPurgedError";
  }
}
