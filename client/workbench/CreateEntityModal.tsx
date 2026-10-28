import { WorkbenchDialog as Modal, dialogFormStyles } from "./WorkbenchDialog";
import { useRpc, useSettings, openExternalUrl } from "@getpaseo/plugin/client";
import { FlatList, Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, useWindowDimensions, type TextStyle, type ViewStyle } from "react-native";
import { childTypesRpc, createFieldsRpc, createRpc, filterOptionsRpc, tapdSettings, type EntityKind } from "../../shared/contracts";
import { Chip, type WorkbenchTheme } from "./bits";
import { DatePicker } from "./DatePicker";

/** 宽松校验 YYYY-MM-DD（日历行展示用） */
function parseKey(key: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

/** fields_info 的 text 自定义字段常被管理员拿来存日期（如「开始时间」「结束时间」），按 label/key 猜日期语义启用日历 */
function looksLikeDateField(field: { key: string; label: string }): boolean {
  return /时间|日期/.test(field.label) || /date|time/i.test(field.key);
}

const KIND_TITLES: Record<EntityKind, string> = { story: "需求", task: "任务", bug: "缺陷" };

type ModalMode = { name: "form" } | { name: "iteration" } | { name: "date"; fieldKey: string } | { name: "layout" };

export interface CreatedEntity {
  id: string;
  kind: EntityKind;
  url: string;
  title: string;
}

/** 从需求详情发起创建时的预填上下文：锁类别为任务/缺陷并挂到该需求 */
export interface CreateChildPreset {
  kind: EntityKind;
  storyId: string;
  workspaceId: string;
  storyTitle: string;
  storyUrl: string;
}

export function CreateEntityModal({ open, onClose, theme, onCreated, initial, backToDetail }: {
  open: boolean;
  backToDetail?: boolean;
  onClose: () => void;
  theme: WorkbenchTheme;
  onCreated: (created: CreatedEntity) => void;
  initial?: CreateChildPreset | null;
}) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const create = useRpc(createRpc);
  const fetchTypes = useRpc(childTypesRpc);
  const [workitemTypeId, setWorkitemTypeId] = useState("");
  const [acceptedUnverified, setAcceptedUnverified] = useState("");
  const typesQuery = useQuery({ queryKey: ["tapd-child-types", initial?.workspaceId, initial?.storyId],
    queryFn: () => fetchTypes({ workspaceId: initial!.workspaceId, id: initial!.storyId }), enabled: open && initial?.kind === "story", retry: false });
  const fetchCreateFields = useRpc(createFieldsRpc);
  const fetchOptions = useRpc(filterOptionsRpc);
  const optionsQuery = useQuery({
    queryKey: ["tapd-filter-options"],
    queryFn: () => fetchOptions({}),
    enabled: open,
    staleTime: 600_000,
    retry: 1,
  });
  const toast = useToast();

  const [kind, setKind] = useState<EntityKind>("story");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [owner, setOwner] = useState("");
  const [ownerTouched, setOwnerTouched] = useState(false);
  const [priority, setPriority] = useState("");
  const [iterationId, setIterationId] = useState("");
  const [extraValues, setExtraValues] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<ModalMode>({ name: "form" });
  const [submitting, setSubmitting] = useState(false);
  const fieldsQuery = useQuery({
    queryKey: ["tapd-create-fields", kind, initial?.workspaceId ?? "", workitemTypeId],
    queryFn: () => fetchCreateFields({ kind, workspaceId: initial?.workspaceId ?? "", workitemTypeId: workitemTypeId || undefined }),
    enabled: open && initial !== null,
    staleTime: 600_000,
    retry: 1,
  });
  const settings = useSettings(tapdSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  /** 动态字段按用户布局排序（order 优先，未登记字段按服务端原序），并按 kind 过滤隐藏项 */
  const orderedFields = useMemo(() => {
    const list = fieldsQuery.data?.fields ?? [];
    const layout = settings.status === "ready" ? settings.values.createFieldLayout[kind] : undefined;
    const indexOf = new Map((layout?.order ?? []).map((key, index) => [key, index]));
    return [...list].sort((a, b) => {
      const ai = indexOf.get(a.key);
      const bi = indexOf.get(b.key);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return 0;
    });
  }, [fieldsQuery.data, kind, settings.status, settings]);

  function persistLayout(nextOrder: string[], nextHidden: string[]) {
    const current = settingsRef.current;
    if (current.status !== "ready") {
      toast.error("设置尚未就绪，无法保存字段布局");
      return;
    }
    const job = async () => {
      // 串行执行：取最新 settings 快照避免连续保存时 revision 冲突
      const latest = settingsRef.current;
      if (latest.status !== "ready") return;
      const ok = await latest.save(
        {
          ...latest.values,
          createFieldLayout: {
            ...latest.values.createFieldLayout,
            [kind]: { order: nextOrder, hidden: nextHidden },
          },
        },
        latest.revision,
      );
      if (!ok) toast.error(latest.saveError ?? "字段布局保存失败");
    };
    saveQueueRef.current = saveQueueRef.current.then(job).catch(() => {});
  }

  const { visibleFields, hiddenFields } = useMemo(() => {
    const hidden = new Set(
      settings.status === "ready" ? settings.values.createFieldLayout[kind]?.hidden ?? [] : [],
    );
    return {
      visibleFields: orderedFields.filter((field) => field.required || !hidden.has(field.key)),
      hiddenFields: orderedFields.filter((field) => !field.required && hidden.has(field.key)),
    };
  }, [orderedFields, settings.status, settings, kind]);

  useEffect(() => {
    if (!open) {
      setKind("story");
      setWorkitemTypeId("");
      setAcceptedUnverified("");
      setTitle("");
      setDescription("");
      setOwner("");
      setOwnerTouched(false);
      setPriority("");
      setIterationId("");
      setExtraValues({});
      setMode({ name: "form" });
      setSubmitting(false);
    } else if (initial) {
      setKind(initial.kind);
    }
  }, [open, initial]);

  // 挂载创建：fields_info 就绪且用户未手改过处理人时，默认填当前登录用户
  const me = fieldsQuery.data?.me ?? "";
  useEffect(() => {
    if (!ownerTouched && me && owner === "") setOwner(me);
  }, [ownerTouched, me, owner]);

  const hasDraft = !!(title || description || (ownerTouched && owner !== me) || priority || iterationId || Object.values(extraValues).some(Boolean) || kind !== (initial?.kind ?? "story"));

  const priorityOptions = useMemo(
    () => (optionsQuery.data?.priorities ?? []).filter((option) => option.kinds.includes(kind)),
    [optionsQuery.data, kind],
  );
  const iterations = optionsQuery.data?.iterations ?? [];
  const iterationLabel = iterationId
    ? iterations.find((item) => item.id === iterationId)?.name ?? iterationId
    : "全部迭代";

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed || submitting || !!acceptedUnverified || (initial?.kind === "story" && !workitemTypeId)) return;
    setSubmitting(true);
    try {
      const created = await create({
        kind,
        title: trimmed,
        description: description.trim(),
        owner: owner.trim(),
        priority,
        iterationId,
        storyId: initial && initial.kind !== "story" ? initial.storyId : undefined,
        parentStoryId: initial?.kind === "story" ? initial.storyId : undefined,
        workitemTypeId: initial?.kind === "story" ? workitemTypeId : undefined,
        workspaceId: initial ? initial.workspaceId : undefined,
        extraFields: initial ? extraValues : undefined,
      });
      if (created.outcome === "unverified") { setAcceptedUnverified(`创建已被接受，但父级关系未核实（#${created.id}），请只读核查，不要重复创建。`); toast.error(`创建关系待核实 #${created.id}`); return; }
      toast.show(`已创建「${trimmed}」#${created.id}`, { variant: "success" });
      onCreated({ id: created.id, kind: created.kind, url: created.url, title: trimmed });
      onClose();
    } catch (error) {
      setAcceptedUnverified("创建结果未知，请先只读核查，避免重复创建。");
      toast.error("创建失败或结果未知，请先只读核查；关闭并确认后再提交，避免重复创建。");
    } finally {
      setSubmitting(false);
    }
  }

  const styles = useMemo<{
    row: ViewStyle;
    rowLabel: TextStyle;
    input: TextStyle;
    inputMultiline: TextStyle;
    chips: ViewStyle;
    backRow: ViewStyle;
    link: TextStyle;
    footer: ViewStyle;
    primaryButton: ViewStyle;
    primaryLabel: TextStyle;
    disabledButton: ViewStyle;
    optionRow: ViewStyle;
    optionText: TextStyle;
    hiddenText: TextStyle;
    layoutActions: ViewStyle;
    layoutAction: ViewStyle;
  }>(() => ({
    row: { flexDirection: "column", alignItems: "stretch", gap: 8, width: wide ? "48%" : "100%" },
    rowLabel: { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 20 },
    input: { ...dialogFormStyles(theme).input, flex: 1 },
    inputMultiline: { minHeight: 180, textAlignVertical: "top" },
    chips: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", flex: 1 },
    backRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
    link: { color: theme.colors.accent, fontSize: 13 },
    footer: dialogFormStyles(theme).footer,
    primaryButton: dialogFormStyles(theme).primaryButton,
    primaryLabel: dialogFormStyles(theme).primaryLabel,
    disabledButton: { opacity: 0.5 },
    optionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 11,
      paddingHorizontal: 4,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    optionText: { color: theme.colors.foreground, fontSize: 13, flex: 1 },
    hiddenText: { color: theme.colors.foregroundMuted, opacity: 0.6 },
    layoutActions: { flexDirection: "row", gap: 4, flexShrink: 0 },
    layoutAction: {
      padding: 6,
      borderRadius: 6,
      backgroundColor: theme.colors.surface2,
      alignItems: "center",
      justifyContent: "center",
    },
  }), [theme, wide]);

  if (mode.name === "date") {
    const dateField = fieldsQuery.data?.fields.find((field) => field.key === mode.fieldKey);
    if (dateField) {
      return (
        <Modal theme={theme} dirty={hasDraft} pending={submitting} onBack={backToDetail ? onClose : undefined} title={`新建单据 · 选择${dateField.label}`} open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
          <Modal.Content scrollable={false} contentContainerStyle={{ padding: 0, gap: 0 }}>
            <View style={{ flex: 1, minHeight: 0, gap: 10, padding: 14 }}>
              <Pressable accessibilityRole="button" style={styles.backRow} onPress={() => setMode({ name: "form" })}>
                <Icon name="ChevronLeft" size={16} color={theme.colors.accent} />
                <Text style={styles.link}>返回</Text>
              </Pressable>
              <DatePicker
                theme={theme}
                value={extraValues[dateField.key] ?? ""}
                onChange={(next) => {
                  setExtraValues((prev) => ({ ...prev, [dateField.key]: next }));
                  if (next) setMode({ name: "form" });
                }}
              />
            </View>
          </Modal.Content>
        </Modal>
      );
    }
  }

  if (mode.name === "layout") {
    const layoutRowTypeModalTitle = `新建单据 · ${KIND_TITLES[kind]}字段布局`;
    const rows: Array<
      | { type: "header"; text: string }
      | { type: "field"; key: string; label: string; hidden: boolean }
      | { type: "hint"; text: string }
    > = [
      { type: "header", text: "显示中（↑↓ 调整顺序）" },
      ...visibleFields.map((field) => ({
        type: "field" as const,
        key: field.key,
        label: `${field.label}${field.required ? " * " : ""}`,
        hidden: false,
      })),
      { type: "header", text: "已隐藏（点之恢复显示）" },
      ...hiddenFields.map((field) => ({
        type: "field" as const,
        key: field.key,
        label: `${field.label}${field.required ? " * " : ""}`,
        hidden: true,
      })),
      { type: "hint", text: "布局按单据类型保存在本机" },
    ];
    const hideField = (key: string) => {
      persistLayout(
        visibleFields.map((field) => field.key).filter((item) => item !== key),
        hiddenFields.map((field) => field.key).concat([key]),
      );
    };
    const restoreField = (key: string) => {
      persistLayout(
        visibleFields.map((field) => field.key).concat([key]),
        hiddenFields.map((field) => field.key).filter((item) => item !== key),
      );
    };
    const moveField = (key: string, delta: -1 | 1) => {
      const order = visibleFields.map((field) => field.key);
      const index = order.indexOf(key);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= order.length) return;
      order.splice(target, 0, order.splice(index, 1)[0]);
      persistLayout(order, hiddenFields.map((field) => field.key));
    };
    return (
      <Modal theme={theme} dirty={hasDraft} pending={submitting} onBack={backToDetail ? onClose : undefined} title={layoutRowTypeModalTitle} open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
        <Modal.Content scrollable={false} contentContainerStyle={{ padding: 0, gap: 0 }}>
          <View style={{ flex: 1, minHeight: 0, paddingTop: 8, paddingHorizontal: 14 }}>
            <Pressable accessibilityRole="button" style={styles.backRow} onPress={() => setMode({ name: "form" })}>
              <Icon name="ChevronLeft" size={16} color={theme.colors.accent} />
              <Text style={styles.link}>返回</Text>
            </Pressable>
            <FlatList
              style={{ flex: 1, minHeight: 0 }}
              data={rows}
              keyExtractor={(item, index) =>
                item.type === "field" ? item.key : item.type === "header" ? `header-${item.text}` : `hint-${index}`
              }
              renderItem={({ item }) => {
                if (item.type === "header") {
                  return (
                    <Text style={{
                      color: theme.colors.foregroundMuted,
                      fontSize: 12,
                      paddingTop: 10,
                      paddingBottom: 2,
                    }}>
                      {item.text}
                    </Text>
                  );
                }
                if (item.type === "hint") {
                  return (
                    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, paddingVertical: 10 }}>
                      {item.text}
                    </Text>
                  );
                }
                return (
                  <View style={styles.optionRow}>
                    <Pressable
                      accessibilityRole="button"
                      style={{ flex: 1 }}
                      disabled={item.hidden}
                      onPress={() => restoreField(item.key)}
                    >
                      <Text style={[styles.optionText, item.hidden ? styles.hiddenText : null]} numberOfLines={1}>
                        {item.label}
                      </Text>
                    </Pressable>
                    {item.hidden ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`恢复显示 ${item.label}`}
                        style={styles.layoutAction}
                        onPress={() => restoreField(item.key)}
                      >
                        <Icon name="Eye" size={14} color={theme.colors.accent} />
                      </Pressable>
                    ) : (
                      <View style={styles.layoutActions}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`上移 ${item.label}`}
                          style={styles.layoutAction}
                          onPress={() => moveField(item.key, -1)}
                        >
                          <Icon name="ChevronUp" size={14} color={theme.colors.foregroundMuted} />
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`下移 ${item.label}`}
                          style={styles.layoutAction}
                          onPress={() => moveField(item.key, 1)}
                        >
                          <Icon name="ChevronDown" size={14} color={theme.colors.foregroundMuted} />
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`隐藏 ${item.label}`}
                          style={styles.layoutAction}
                          onPress={() => hideField(item.key)}
                        >
                          <Icon name="EyeOff" size={14} color={theme.colors.accent} />
                        </Pressable>
                      </View>
                    )}
                  </View>
                );
              }}
            />
          </View>
        </Modal.Content>
      </Modal>
    );
  }

  if (mode.name === "iteration") {
    const rows = [{ id: "", name: "全部迭代", status: "" }, ...iterations];
    return (
      <Modal theme={theme} dirty={hasDraft} pending={submitting} onBack={backToDetail ? onClose : undefined} title="新建单据 · 选择迭代" open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
        <Modal.Content scrollable={false} contentContainerStyle={{ padding: 0, gap: 0 }}>
          <View style={{ flex: 1, minHeight: 0, paddingTop: 8, paddingHorizontal: 14 }}>
            <Pressable accessibilityRole="button" style={styles.backRow} onPress={() => setMode({ name: "form" })}>
              <Icon name="ChevronLeft" size={16} color={theme.colors.accent} />
              <Text style={styles.link}>返回</Text>
            </Pressable>
            <FlatList
              style={{ flex: 1, minHeight: 0 }}
              data={rows}
              keyExtractor={(item) => item.id || "__all__"}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  style={styles.optionRow}
                  onPress={() => {
                    setIterationId(item.id);
                    setMode({ name: "form" });
                  }}
                >
                  <Text style={styles.optionText} numberOfLines={1}>
                    {item.id === "" ? item.name : item.status === "done" ? `${item.name}（已关闭）` : item.name}
                  </Text>
                  {iterationId === item.id ? <Icon name="Check" size={16} color={theme.colors.accent} /> : null}
                </Pressable>
              )}
            />
          </View>
        </Modal.Content>
      </Modal>
    );
  }

  return (
    <Modal theme={theme} dirty={hasDraft} pending={submitting} onBack={backToDetail ? onClose : undefined} title="新建单据" open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Modal.Content>
        <View style={{ gap: 24 }}>
          <View style={{ gap: 16 }}>
          <Text accessibilityRole="header" style={{ color: theme.colors.foreground, fontSize: 16, fontWeight: "600" }}>基本信息</Text>
          {initial?.kind === "story" && <View style={{ gap: 8 }}><Text style={styles.rowLabel}>子需求类别 *</Text>
            {typesQuery.isError ? <Text style={{ color: theme.colors.statusDanger }}>允许的子需求类别读取失败，请关闭后重试。</Text> : typesQuery.isPending ? <Text style={styles.rowLabel}>正在读取允许的类别…</Text> : !typesQuery.data?.types.length ? <Text style={{ color: theme.colors.statusWarning }}>此父需求没有可创建的子需求类别。</Text> : <View style={styles.chips}>{typesQuery.data.types.map(type => <Chip key={type.id} label={type.name} theme={theme} active={workitemTypeId === type.id} onPress={() => setWorkitemTypeId(type.id)} />)}</View>}
          </View>}
          {acceptedUnverified && <Text style={{ color: theme.colors.statusWarning }}>{acceptedUnverified}</Text>}
          {initial ? (
            <View style={[styles.row, { width: "100%" }]}>
              <Text style={styles.rowLabel}>挂载到</Text>
              <Pressable accessibilityRole="button" onPress={() => void openExternalUrl(initial.storyUrl)}>
                <Text style={{ ...styles.link, flex: 1 }} numberOfLines={1}>
                  #{initial.storyId} {initial.storyTitle || "（标题未获取）"}
                </Text>
              </Pressable>
            </View>
          ) : null}
          <View style={[styles.row, { width: "100%" }]}>
            <Text style={styles.rowLabel}>类型</Text>
            <View style={styles.chips}>
              {(initial ? (initial.kind === "story" ? (["story"] as const) : (["task", "bug"] as const)) : (["story", "task", "bug"] as const)).map((item) => (
                <Chip
                  key={item}
                  label={KIND_TITLES[item]}
                  theme={theme}
                  active={kind === item}
                  onPress={() => {
                    setKind(item);
                    setPriority("");
                    setExtraValues({});
                  }}
                />
              ))}
            </View>
          </View>
          {initial ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="管理字段顺序与隐藏"
              style={styles.optionRow}
              onPress={() => setMode({ name: "layout" })}
            >
              <Icon name="SlidersHorizontal" size={14} color={theme.colors.foregroundMuted} />
              <Text style={[styles.optionText, { flex: undefined, width: 64, color: theme.colors.foregroundMuted, fontSize: 13 }]}>
                字段布局
              </Text>
              <Text style={styles.optionText} numberOfLines={1}>
                调整顺序、隐藏 / 恢复字段
              </Text>
              <Icon name="ChevronRight" size={15} color={theme.colors.foregroundMuted} />
            </Pressable>
          ) : null}
          <View style={[styles.row, { width: "100%" }]}>
            <Text style={styles.rowLabel}>标题 *</Text>
            <TextInput
              style={styles.input}
              accessibilityLabel="标题（必填）"
              placeholder="请输入清楚的单据标题"
              placeholderTextColor={theme.colors.foregroundMuted}
              value={title}
              onChangeText={setTitle}
            />
          </View>
          <View style={[styles.row, { width: "100%" }]}>
            <Text style={[styles.rowLabel, { paddingTop: 8 }]}>描述</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              accessibilityLabel="描述"
              placeholder="描述背景、目标与验收要求"
              placeholderTextColor={theme.colors.foregroundMuted}
              multiline
              value={description}
              onChangeText={setDescription}
            />
          </View>
          </View>
          <View style={{ gap: 16 }}>
          <Text accessibilityRole="header" style={{ color: theme.colors.foreground, fontSize: 16, fontWeight: "600" }}>处理安排</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>处理人</Text>
            <TextInput
              style={styles.input}
              accessibilityLabel="处理人"
              placeholder="昵称，默认当前登录用户"
              placeholderTextColor={theme.colors.foregroundMuted}
              value={owner}
              onChangeText={(text) => {
                setOwnerTouched(true);
                setOwner(text);
              }}
            />
          </View>
          {priorityOptions.length > 0 ? (
            <View style={styles.row}>
              <Text style={styles.rowLabel}>优先级</Text>
              <View style={styles.chips}>
                {priorityOptions.map((option) => (
                  <Chip
                    key={option.value}
                    label={option.label === option.value ? option.value : option.label}
                    theme={theme}
                    active={priority === option.value}
                    onPress={() => setPriority(priority === option.value ? "" : option.value)}
                  />
                ))}
              </View>
            </View>
          ) : null}
          <Pressable accessibilityRole="button" style={styles.optionRow} onPress={() => setMode({ name: "iteration" })}>
            <Text style={[styles.optionText, { flex: undefined, width: 64, color: theme.colors.foregroundMuted, fontSize: 13 }]}>迭代</Text>
            <Text style={styles.optionText} numberOfLines={1}>{iterationLabel}</Text>
            <Icon name="ChevronRight" size={15} color={theme.colors.foregroundMuted} />
          </Pressable>
          </View>
          </View>
          {initial ? <View style={{ gap: 16 }}>
            <Text accessibilityRole="header" style={{ color: theme.colors.foreground, fontSize: 16, fontWeight: "600" }}>扩展字段</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            {visibleFields.map((field) => {
                const value = extraValues[field.key] ?? "";
                const setValue = (text: string) => setExtraValues((prev) => ({ ...prev, [field.key]: text }));
                const label = `${field.label}${field.required ? " *" : ""}`;
                if (field.inputKind === "enum" || field.inputKind === "user") {
                  return (
                    <View key={field.key} style={styles.row}>
                      <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
                      <View style={styles.chips}>
                        {field.options.length > 0 && field.options.length <= 8
                          ? field.options.map((option) => {
                              const active = field.single ? value === option.value : value.split(";").includes(option.value);
                              return (
                                <Chip
                                  key={option.value}
                                  label={option.label}
                                  theme={theme}
                                  active={active}
                                  onPress={() => {
                                    if (field.single) {
                                      setValue(active ? "" : option.value);
                                    } else {
                                      const list = value.split(";").filter(Boolean);
                                      const next = active
                                        ? list.filter((item) => item !== option.value)
                                        : [...list, option.value];
                                      setValue(next.join(";"));
                                    }
                                  }}
                                />
                              );
                            })
                          : (
                              <TextInput
                                style={styles.input}
                                placeholder={
                                  field.inputKind === "user"
                                    ? "昵称，多个用英文分号分隔"
                                    : "可选，多个用英文分号分隔"
                                }
                                placeholderTextColor={theme.colors.foregroundMuted}
                                value={value}
                                onChangeText={setValue}
                              />
                            )}
                      </View>
                    </View>
                  );
                }
                if (field.inputKind === "textarea") {
                  return (
                    <View key={field.key} style={[styles.row, { width: "100%" }]}>
                      <Text style={[styles.rowLabel, { paddingTop: 8 }]}>{label}</Text>
                      <TextInput
                        style={[styles.input, styles.inputMultiline]}
                        accessibilityLabel={label}
                        placeholder={field.required ? "必填" : "可选"}
                        placeholderTextColor={theme.colors.foregroundMuted}
                        multiline
                        value={value}
                        onChangeText={setValue}
                      />
                    </View>
                  );
                }
                if (field.inputKind === "date" || looksLikeDateField(field)) {
                  const dateValue = value ? parseKey(value) : null;
                  return (
                    <Pressable
                      key={field.key}
                      accessibilityRole="button"
                      accessibilityLabel={`选择${field.label}`}
                      style={styles.optionRow}
                      onPress={() => setMode({ name: "date", fieldKey: field.key })}
                    >
                      <Text style={[styles.optionText, { flex: undefined, width: 96, color: theme.colors.foregroundMuted, fontSize: 13 }]} numberOfLines={1}>
                        {label}
                      </Text>
                      <Text style={styles.optionText} numberOfLines={1}>{dateValue ? value : "未选择"}</Text>
                      <Icon name="ChevronRight" size={15} color={theme.colors.foregroundMuted} />
                    </Pressable>
                  );
                }
                return (
                  <View key={field.key} style={styles.row}>
                    <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
                    <TextInput
                      style={styles.input}
                      accessibilityLabel={label}
                        placeholder={field.required ? "必填" : "可选"}
                      placeholderTextColor={theme.colors.foregroundMuted}
                      value={value}
                      onChangeText={setValue}
                    />
                  </View>
                );
              })}
            </View>
          </View> : null}
          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              style={[styles.primaryButton, !title.trim() || submitting ? styles.disabledButton : null]}
              disabled={!title.trim() || submitting || !!acceptedUnverified || (initial?.kind === "story" && !workitemTypeId)}
              onPress={() => void submit()}
            >
              <Text style={styles.primaryLabel}>{submitting ? "创建中…" : "创建"}</Text>
            </Pressable>
          </View>
        </View>
      </Modal.Content>
    </Modal>
  );
}
