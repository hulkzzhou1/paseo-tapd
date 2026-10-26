import type { RpcOutput } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { FlatList, Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View, type TextStyle } from "react-native";
import { filterFieldsRpc, type EntityKind, type TapdCondition, type TapdFilters } from "../../shared/contracts";
import { type WorkbenchTheme } from "./bits";

type FilterField = RpcOutput<typeof filterFieldsRpc>["fields"][number];
const KIND_SHORT: Record<EntityKind, string> = { story: "需求", task: "任务", bug: "缺陷" };

/** 本地草稿 + 防抖提交（避免每个按键都发请求） */
function useDebouncedDraft(value: string, apply: (text: string) => void): [string, (text: string) => void] {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => apply(draft), 400);
    return () => clearTimeout(timer);
  }, [draft, value, apply]);
  return [draft, setDraft];
}

function sameKinds(a: readonly EntityKind[], b: readonly EntityKind[]): boolean {
  return [...a].sort().join("|") === [...b].sort().join("|");
}

function conditionSummary(condition: TapdCondition): string {
  if (condition.kind === "date") return `${condition.from || "*"} ~ ${condition.to || "*"}`;
  const visible = condition.values.slice(0, 3).join("、");
  return `${visible}${condition.values.length > 3 ? ` 等${condition.values.length}项` : ""}` || "(空)";
}

export function AdditionalFilters({ theme, filters, onChange }: {
  theme: WorkbenchTheme;
  filters: TapdFilters;
  onChange: (patch: Partial<TapdFilters>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<FilterField | null>(null);
  const [fieldValues, setFieldValues] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const fetchFields = useRpc(filterFieldsRpc);
  const fieldsQuery = useQuery({
    queryKey: ["tapd-filter-fields"], queryFn: () => fetchFields({}),
    enabled: open, staleTime: 1_800_000, retry: 1,
  });
  const applyKeyword = useCallback((text: string) => onChange({ keyword: text }), [onChange]);
  const applyLabel = useCallback((text: string) => onChange({ label: text }), [onChange]);
  const [keywordDraft, setKeywordDraft] = useDebouncedDraft(filters.keyword, applyKeyword);
  const [labelDraft, setLabelDraft] = useDebouncedDraft(filters.label, applyLabel);
  const colors = theme.colors;
  const input: TextStyle = {
    backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 7, color: colors.foreground, fontSize: 12,
  };
  const query = search.trim().toLowerCase();
  const fields = (fieldsQuery.data?.fields ?? []).filter(field =>
    field.label.toLowerCase().includes(query) || field.key.toLowerCase().includes(query));
  const canConfirm = picked && (picked.kind === "date" ? !!(from.trim() || to.trim())
    : picked.kind === "enum" && picked.options.length > 0 ? fieldValues.length > 0 : !!fieldValues[0]?.trim());

  function pickField(field: FilterField) {
    setPicked(field); setFieldValues([]); setFrom(""); setTo("");
  }

  function confirm() {
    if (!picked || !canConfirm) return;
    const condition: TapdCondition = {
      field: picked.key, label: picked.label, kind: picked.kind, kinds: [...picked.kinds],
      values: picked.kind === "date" ? [] : picked.kind === "enum" ? fieldValues : fieldValues.slice(0, 1).map(value => value.trim()),
      from: picked.kind === "date" ? from.trim() : "", to: picked.kind === "date" ? to.trim() : "",
    };
    onChange({ conditions: [...filters.conditions.filter(item =>
      !(item.field === picked.key && sameKinds(item.kinds, picked.kinds))), condition] });
    setOpen(false);
  }

  return <>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>关键词</Text>
      <TextInput accessibilityLabel="关键词" placeholder="标题模糊匹配" placeholderTextColor={colors.foregroundMuted}
        value={keywordDraft} onChangeText={setKeywordDraft} style={[input, { width: 160 }]} />
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>标签</Text>
      <TextInput accessibilityLabel="标签" placeholder="精确匹配" placeholderTextColor={colors.foregroundMuted}
        value={labelDraft} onChangeText={setLabelDraft} style={[input, { width: 140 }]} />
    </View>
    {filters.conditions.map(condition => <View key={`${condition.field}-${condition.kinds.join()}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 6, maxWidth: 280, paddingHorizontal: 8, borderWidth: 1, borderColor: colors.accent, borderRadius: 6, backgroundColor: colors.surface1 }}>
      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, flexShrink: 1 }}>
        {`${condition.label || condition.field}：${conditionSummary(condition)}`}
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`移除${condition.label || condition.field}条件`}
        style={{ padding: 8 }} onPress={() => onChange({ conditions: filters.conditions.filter(item => item !== condition) })}>
        <Icon name="X" size={14} color={colors.foregroundMuted} />
      </Pressable>
    </View>)}
    <Pressable accessibilityRole="button" accessibilityLabel="添加条件" style={{ paddingHorizontal: 10, paddingVertical: 8 }}
      onPress={() => { setSearch(""); setPicked(null); setOpen(true); }}>
      <Text style={{ color: colors.accent, fontSize: 12 }}>+ 添加条件</Text>
    </Pressable>
    <Modal title={picked ? `设置条件 · ${picked.label}` : "添加条件"} open={open} onOpenChange={setOpen}>
      <Modal.Content scrollable={picked !== null} contentContainerStyle={picked ? undefined : { padding: 14, gap: 8 }}>
        {!picked ? <View style={{ flex: 1, minHeight: 0, gap: 8 }}>
          <TextInput accessibilityLabel="搜索过滤条件" placeholder="搜索过滤条件（中文名或字段 key）" placeholderTextColor={colors.foregroundMuted}
            value={search} onChangeText={setSearch} style={input} />
          {fieldsQuery.isPending ? <ActivityIndicator color={colors.accent} /> : null}
          {fieldsQuery.isError ? <View style={{ gap: 8 }}>
            <Text accessibilityRole="alert" style={{ color: colors.statusDanger }}>字段加载失败，请重试。</Text>
            <Pressable accessibilityRole="button" onPress={() => void fieldsQuery.refetch()}>
              <Text style={{ color: colors.accent }}>重试</Text>
            </Pressable>
          </View> : !fieldsQuery.isPending && !fields.length ? <Text style={{ color: colors.foregroundMuted }}>没有匹配的字段。</Text> : null}
          <FlatList style={{ flex: 1, minHeight: 0 }} data={fields} keyExtractor={field => `${field.key}-${field.kinds.join()}`}
            renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => pickField(item)}
              style={{ flexDirection: "row", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.border }}>
              <Text style={{ flex: 1, color: colors.foreground }}>{item.label}</Text>
              <Text style={{ color: colors.foregroundMuted }}>{item.kinds.map(kind => KIND_SHORT[kind]).join("/")} · {item.key}</Text>
            </Pressable>} />
        </View> : <View style={{ gap: 12 }}>
          <Pressable accessibilityRole="button" onPress={() => setPicked(null)}>
            <Text style={{ color: colors.accent }}>返回</Text>
          </Pressable>
          <Text style={{ color: colors.foregroundMuted }}>{picked.label}（{picked.key} · {picked.kinds.map(kind => KIND_SHORT[kind]).join("/")}）</Text>
          {picked.kind === "date" ? <>
            <TextInput accessibilityLabel="开始日期" placeholder="开始日期，例如 2026-01-01（可留空）" placeholderTextColor={colors.foregroundMuted} value={from} onChangeText={setFrom} style={input} />
            <TextInput accessibilityLabel="结束日期" placeholder="结束日期，例如 2026-12-31（可留空）" placeholderTextColor={colors.foregroundMuted} value={to} onChangeText={setTo} style={input} />
          </> : picked.kind === "enum" && picked.options.length > 0 ? picked.options.map(option => <Pressable key={option.value} accessibilityRole="checkbox"
            accessibilityState={{ checked: fieldValues.includes(option.value) }} onPress={() => setFieldValues(current => picked.single ? [option.value]
              : current.includes(option.value) ? current.filter(value => value !== option.value) : [...current, option.value])}
            style={{ flexDirection: "row", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.border }}>
            <Text style={{ flex: 1, color: colors.foreground }}>{option.label === option.value ? option.value : `${option.label}（${option.value}）`}</Text>
            {fieldValues.includes(option.value) ? <Icon name="Check" size={16} color={colors.accent} /> : null}
          </Pressable>) : <TextInput accessibilityLabel="条件值" placeholder={picked.kind === "user" ? "输入人员昵称" : "输入匹配值"}
            placeholderTextColor={colors.foregroundMuted} value={fieldValues[0] ?? ""} onChangeText={text => setFieldValues([text])} style={input} />}
          <Pressable accessibilityRole="button" disabled={!canConfirm} onPress={confirm}
            style={{ alignSelf: "flex-end", backgroundColor: colors.accent, borderRadius: 6, paddingHorizontal: 14, paddingVertical: 8, opacity: canConfirm ? 1 : 0.5 }}>
            <Text style={{ color: colors.accentForeground }}>确定</Text>
          </Pressable>
        </View>}
      </Modal.Content>
    </Modal>
  </>;
}
