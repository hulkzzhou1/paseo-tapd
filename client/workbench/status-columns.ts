import type { BoardEntityItem } from "./ColumnView";

export function buildStatusColumns(
  items: readonly BoardEntityItem[],
  canonical: readonly { value: string; label: string }[],
  explicit: readonly string[] | null,
): {
  pickerStatuses: { value: string; label: string }[];
  pickerCounts: Record<string, number>;
  columns: { status: string; label: string; items: BoardEntityItem[] }[];
} {
  const pickerStatuses = canonical.map((status) => ({ value: status.value, label: status.label }));
  const seen = new Set(pickerStatuses.map((status) => status.value));
  for (const item of items) {
    if (!seen.has(item.status)) {
      seen.add(item.status);
      pickerStatuses.push({ value: item.status, label: item.statusLabel });
    }
  }
  const pickerCounts: Record<string, number> = {};
  for (const item of items) {
    pickerCounts[item.status] = (pickerCounts[item.status] ?? 0) + 1;
  }
  const selected =
    explicit && explicit.length > 0 ? new Set(explicit)
      : new Set(pickerStatuses.filter((status) => (pickerCounts[status.value] ?? 0) > 0).map((status) => status.value));
  const ordered: string[] = [];
  const remaining = new Set(selected);
  for (const status of pickerStatuses) {
    if (remaining.has(status.value)) {
      ordered.push(status.value);
      remaining.delete(status.value);
    }
  }
  for (const value of remaining) ordered.push(value);
  const columns = ordered.map((status) => ({
    status,
    label: pickerStatuses.find((entry) => entry.value === status)?.label ?? status,
    items: items.filter((item) => item.status === status),
  }));
  return { pickerStatuses, pickerCounts, columns };
}

