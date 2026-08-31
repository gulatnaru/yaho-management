export function formatKrw(amount: number) {
  return `${new Intl.NumberFormat("ko-KR").format(amount)}원`;
}
