// Office days as the schedule shows them, Monday first: "Mon–Sat",
// "Every day", "Mon, Wed, Fri". Days are 0 = Sunday ... 6 = Saturday.
export const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
const NAME = Object.fromEntries(DAYS);

export function describeDays(days) {
  const order = DAYS.map(([d]) => d).filter((d) => days.includes(d));
  if (order.length === 7) return 'Every day';
  const positions = order.map((d) => DAYS.findIndex(([x]) => x === d));
  const contiguous = positions.every((p, i) => i === 0 || p === positions[i - 1] + 1);
  return contiguous && order.length > 2
    ? `${NAME[order[0]]}–${NAME[order[order.length - 1]]}`
    : order.map((d) => NAME[d]).join(', ');
}
