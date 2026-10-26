import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";
import { filterOptionsRpc, membersRpc, type TapdFilters } from "../../shared/contracts";
import { AdvancedFilterChip } from "./AdvancedFilter";
import { Dropdown, type DropdownOption } from "./Dropdown";
import { ToolbarButton, type WorkbenchTheme } from "./bits";

const STATUS_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "active", label: "未结束" },
  { value: "done", label: "已结束" },
];
const TIME_OPTIONS = [
  { value: "0", label: "不限" },
  { value: "7", label: "近 7 天" },
  { value: "30", label: "近 30 天" },
  { value: "90", label: "近 90 天" },
];
const OWNER_MODES = [
  { value: "mode:all", label: "全部人" },
  { value: "mode:mine", label: "我处理的" },
  { value: "mode:related", label: "我相关的" },
];

function withSavedValues(options: readonly DropdownOption[], values: readonly string[]): DropdownOption[] {
  return [...options, ...[...new Set(values)].filter(value => value && !options.some(option => option.value === value))
    .map(value => ({ value, label: value }))];
}

export function FilterBar({ theme, filters, onChange, onReset }: {
  theme: WorkbenchTheme;
  filters: TapdFilters;
  onChange: (patch: Partial<TapdFilters>) => void;
  onReset: () => void;
}) {
  const fetchOptions = useRpc(filterOptionsRpc);
  const optionsQuery = useQuery({
    queryKey: ["tapd-filter-options"],
    queryFn: () => fetchOptions({}),
    staleTime: 600_000,
    retry: 1,
  });
  const [membersEnabled, setMembersEnabled] = useState(false);
  const fetchMembers = useRpc(membersRpc);
  const membersQuery = useQuery({
    queryKey: ["tapd-members"],
    queryFn: () => fetchMembers({}),
    enabled: membersEnabled,
    staleTime: 600_000,
    retry: 1,
  });
  const iterations = withSavedValues((optionsQuery.data?.iterations ?? []).map(item => ({
    value: item.id,
    label: item.status === "done" ? `${item.name}（已关闭）` : item.name,
  })), [filters.iterationId]);
  const priorities = withSavedValues(optionsQuery.data?.priorities ?? [], filters.priorities);
  const members = withSavedValues(membersQuery.data?.members ?? [], [filters.owner, filters.creator]);
  const ownerValue = filters.ownerMode === "custom" ? `member:${filters.owner}` : `mode:${filters.ownerMode}`;
  const ownerOptions = [...OWNER_MODES, ...members.map(item => ({ ...item, value: `member:${item.value}` }))];
  const memberProps = {
    searchable: true,
    onOpen: () => setMembersEnabled(true),
    loading: membersQuery.isFetching,
    error: membersQuery.isError ? "人员候选读取失败，请重试；仍可输入准确昵称。" : membersQuery.data?.error,
    onRetry: () => { void membersQuery.refetch(); },
    theme,
  };
  const optionProps = {
    loading: optionsQuery.isFetching,
    error: optionsQuery.isError ? "筛选选项读取失败，请重试。" : null,
    onRetry: () => { void optionsQuery.refetch(); },
    theme,
  };

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
      <Dropdown label="状态" summary={STATUS_OPTIONS.find(item => item.value === filters.statusScope)?.label ?? "全部"}
        options={STATUS_OPTIONS} selected={[filters.statusScope]} theme={theme}
        onSelect={value => onChange({ statusScope: value as TapdFilters["statusScope"] })} />
      <Dropdown label="迭代" summary={iterations.find(item => item.value === filters.iterationId)?.label ?? "全部"}
        options={[{ value: "", label: "全部" }, ...iterations]} selected={[filters.iterationId]} searchable
        onSelect={value => onChange({ iterationId: value })} {...optionProps} />
      <Dropdown label="更新时间" summary={TIME_OPTIONS.find(item => item.value === String(filters.modifiedWithinDays))?.label ?? `近 ${filters.modifiedWithinDays} 天`}
        options={withSavedValues(TIME_OPTIONS, [String(filters.modifiedWithinDays)])} selected={[String(filters.modifiedWithinDays)]} theme={theme}
        onSelect={value => onChange({ modifiedWithinDays: Number(value) })} />
      <Dropdown label="处理人" summary={ownerOptions.find(item => item.value === ownerValue)?.label ?? "指定成员"}
        options={ownerOptions} selected={[ownerValue]}
        onSelect={value => value.startsWith("member:")
          ? onChange({ ownerMode: "custom", owner: value.slice(7) })
          : onChange({ ownerMode: value.slice(5) as TapdFilters["ownerMode"] })}
        onCustomValue={value => onChange({ ownerMode: "custom", owner: value })} {...memberProps} />
      <Dropdown label="创建人" summary={filters.creator || "全部"}
        options={[{ value: "", label: "全部" }, ...members]} selected={[filters.creator]}
        onSelect={value => onChange({ creator: value })} onCustomValue={value => onChange({ creator: value })} {...memberProps} />
      <Dropdown label="优先级" summary={filters.priorities.length > 1 ? `已选 ${filters.priorities.length} 项` : priorities.find(item => item.value === filters.priorities[0])?.label ?? "全部"}
        options={[{ value: "", label: "全部" }, ...priorities]} selected={filters.priorities.length ? filters.priorities : [""]} multiple
        onSelect={value => onChange({ priorities: !value ? [] : filters.priorities.includes(value)
          ? filters.priorities.filter(item => item !== value) : [...filters.priorities, value] })} {...optionProps} />
      <AdvancedFilterChip theme={theme} filters={filters} onChange={onChange} />
      <ToolbarButton icon="RotateCcw" label="重置" theme={theme} onPress={onReset} />
    </View>
  );
}
