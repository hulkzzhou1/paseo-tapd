export function isCurrentIteration(iteration: { status: string; startDate?: string; endDate?: string }, now = new Date()): boolean {
  if (["done", "closed"].includes(iteration.status)) return false;
  const { startDate, endDate } = iteration;
  const valid = (date: string | undefined): date is string => !!date && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  if (!valid(startDate) || !valid(endDate)) return false;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return startDate <= today && today <= endDate;
}
