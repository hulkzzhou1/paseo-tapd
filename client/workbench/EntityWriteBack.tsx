import {invalidateBoard} from "../conversation/board-updates";
import { WorkbenchDialog as Modal, dialogFormStyles } from "./WorkbenchDialog";
import { useRpc } from "@getpaseo/plugin/client";
import { TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, type TextStyle, type ViewStyle } from "react-native";
import { addCommentRpc, statusOptionsRpc, updateStatusRpc, type EntityKind, type StatusTransition } from "../../shared/contracts";
import { type WorkbenchTheme } from "./bits";
import { Dropdown } from "./Dropdown";

/** 缺陷候选来自当前流转规则；附加字段在操作页确认后提交。 */
export function StatusDropdown({ theme, kind, id, workspaceId, current, currentLabel, onDone, onTransition }: {
  theme: WorkbenchTheme;
  kind: EntityKind;
  id: string;
  /** 单据实际所在项目（多项目配置时保证回写正确） */
  workspaceId: string;
  current: string;
  currentLabel: string;
  onDone: () => void;
  onTransition?: (target: StatusChangeTarget) => void;
}) {
  const fetchOptions = useRpc(statusOptionsRpc);
  const updateStatus = useRpc(updateStatusRpc);
  const toast = useToast();
  const [opened, setOpened] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [writeError, setWriteError] = useState("");
  const [writeLocked, setWriteLocked] = useState(false);

  const optionsQuery = useQuery({
    queryKey: ["tapd-status-options", workspaceId, kind, id, current],
    queryFn: () => fetchOptions({ kind, workspaceId, ...(kind === "bug" ? { id } : {}) }),
    enabled: opened,
    staleTime: 0,
    retry: false,
  });

  const options = (optionsQuery.data?.options ?? []).map(option => {
    const unsupported = optionsQuery.data?.transitions?.find(item => item.value === option.value)?.supported === false;
    return { ...option, label: unsupported ? `${option.label}（请在 TAPD 原站操作）` : option.label, disabled: unsupported };
  });

  async function apply(value: string) {
    if (submittingRef.current || writeLocked || value === current) return false;
    if (kind === "bug") {
      const rules = optionsQuery.data;
      const transition = rules?.transitions?.find(item => item.value === value);
      if (!transition || !transition.supported || rules?.current !== current) {
        setWriteError("流转规则或当前状态已变化，请刷新详情核对。");
        onDone(); return false;
      }
      if (transition.fields.length) {
        if (!onTransition) { setWriteError("请在完整详情中填写流转字段。"); return false; }
        setOpened(false);
        onTransition({ kind, id, workspaceId, current, transition });
        return true;
      }
    }
    submittingRef.current = true;
    setSubmitting(true);
    setWriteError("");
    try {
      const result = await updateStatus({ kind, id, status: value, workspaceId, ...(kind === "bug" ? { expectedStatus: current, transitionFields: {} } : {}) });
      setOpened(false);
      invalidateBoard({kind,id,workspaceId});
      if (result.outcome === "unverified") {
        if (kind === "bug") setWriteLocked(true);
        toast.show("已接受状态修改，但当前状态未核实；请刷新核对，勿重复提交。");
        if (kind !== "bug") onDone();
        return true;
      }
    } catch {
      if (kind === "bug") setWriteLocked(true);
      setWriteError(kind === "bug" ? "状态未确认，请关闭并重新打开详情核对后再操作，勿重复提交。" : "状态未确认，请读取详情核对后再操作。");
      return false;
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
    toast.show(`状态已更新为「${options.find(option => option.value === value)?.label ?? value}」`, { variant: "success" });
    onDone();
    return true;
  }

  return (
    <Dropdown
      label="修改状态"
      summary={currentLabel || current}
      selected={[current]}
      options={options}
      onSelect={apply}
      onOpen={() => { setWriteError(""); if (opened) void optionsQuery.refetch(); else setOpened(true); }}
      loading={opened && optionsQuery.isFetching}
      disabled={submitting || writeLocked || !workspaceId}
      error={writeError || (optionsQuery.isError ? "读取状态选项失败，请重试。" : null)}
      onRetry={optionsQuery.isError ? () => void optionsQuery.refetch() : undefined}
      theme={theme}
    />
  );
}

export type StatusChangeTarget = { kind: EntityKind; id: string; workspaceId: string; current: string; transition: StatusTransition };

export function StatusTransitionModal({ target, theme, onClose, onDone }: {
  target: StatusChangeTarget; theme: WorkbenchTheme; onClose: () => void; onDone: () => void;
}) {
  const update = useRpc(updateStatusRpc);
  const initial = Object.fromEntries(target.transition.fields.map(field => [field.key, field.value]));
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const styles = dialogFormStyles(theme);
  const missing = target.transition.fields.some(field => field.required && !(values[field.key] ?? "").trim());
  async function submit() {
    if (submitting.current || locked || missing) return;
    submitting.current = true; setPending(true); setError("");
    try {
      const result = await update({ kind: target.kind, id: target.id, workspaceId: target.workspaceId,
        status: target.transition.value, expectedStatus: target.current, transitionFields: values });
      setAccepted(true); setLocked(true);
      invalidateBoard({ kind: target.kind, id: target.id, workspaceId: target.workspaceId }); onDone();
      if (result.outcome === "unverified") { setError("TAPD 已接受修改，但当前状态未核实。请返回详情核对，勿重复提交。"); return; }
      onClose();
    } catch { setLocked(true); setError("状态未确认，输入已保留。请返回详情核对状态和规则后再操作，勿直接重复提交。"); }
    finally { submitting.current = false; setPending(false); }
  }
  return <Modal open theme={theme} title={`修改状态 · ${target.transition.label}`} pending={pending}
    dirty={!accepted && JSON.stringify(values) !== JSON.stringify(initial)} onBack={onClose} onOpenChange={open => { if (!open) onClose(); }}>
    <Modal.Content><View style={{ gap: 18 }}>
      <Text style={{ color: theme.colors.foregroundMuted }}>#{target.id} · 确认流转到「{target.transition.label}」</Text>
      {target.transition.fields.map(field => {
        const value = values[field.key] ?? "";
        const change = (next: string) => setValues(previous => ({ ...previous, [field.key]: next }));
        return <View key={field.key} style={{ gap: 8 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{field.label}{field.required ? " *" : ""}</Text>
          {field.inputKind === "enum" ? <Dropdown label={field.label} summary={value ? value.split(";").map(v => field.options.find(option => option.value === v)?.label ?? v).join("、") : "请选择"}
            theme={theme} options={field.options} selected={field.single ? [value] : value.split(";")} multiple={!field.single} disabled={pending || locked}
            onSelect={next => { change(field.single ? next : value.split(";").includes(next) ? value.split(";").filter(v => v !== next).join(";") : [...value.split(";").filter(Boolean), next].join(";")); }} />
            : <TextInput accessibilityLabel={field.label} style={[styles.input, field.inputKind === "textarea" ? { minHeight: 128, textAlignVertical: "top" } : null]}
              multiline={field.inputKind === "textarea"} editable={!pending && !locked} value={value} maxLength={50_000} onChangeText={change}
              placeholder={field.inputKind === "date" ? "YYYY-MM-DD" : field.inputKind === "user" ? "填写人员昵称" : field.required ? "必填" : "可选"}
              placeholderTextColor={theme.colors.foregroundMuted} />}
        </View>;
      })}
      {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning }}>{error}</Text> : null}
      <View style={styles.footer}><Pressable accessibilityRole="button" accessibilityLabel="确认修改状态" disabled={missing || pending || locked}
        onPress={() => void submit()} style={[styles.primaryButton, missing || pending || locked ? { opacity: 0.5 } : null]}>
        <Text style={styles.primaryLabel}>{pending ? "提交中…" : "确认修改状态"}</Text>
      </Pressable></View>
    </View></Modal.Content>
  </Modal>;
}

/** 写回评论（纯文本自动转 HTML） */
export function CommentModal({ open, onClose, theme, kind, id, workspaceId, onDone, backToDetail }: {
  open: boolean;
  backToDetail?: boolean;
  onClose: () => void;
  theme: WorkbenchTheme;
  kind: EntityKind;
  id: string;
  /** 单据实际所在项目（多项目配置时保证回写正确） */
  workspaceId?: string;
  onDone: () => void;
}) {
  const addComment = useRpc(addCommentRpc);
  const toast = useToast();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setText("");
      setSubmitting(false);
    }
  }, [open]);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await addComment({ kind, id, text: trimmed, workspaceId: workspaceId ?? "" });
      toast.show("评论已写入 TAPD", { variant: "success" });
      onDone();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }

  const styles = useMemo<{ input: TextStyle; footer: ViewStyle; primaryButton: ViewStyle; primaryLabel: TextStyle; disabledButton: ViewStyle }>(() => ({
    input: { ...dialogFormStyles(theme).input, flex: 1 },
    footer: dialogFormStyles(theme).footer,
    primaryButton: dialogFormStyles(theme).primaryButton,
    primaryLabel: dialogFormStyles(theme).primaryLabel,
    disabledButton: { opacity: 0.5 },
  }), [theme]);

  return (
    <Modal theme={theme} dirty={!!text.trim()} pending={submitting} onBack={backToDetail ? onClose : undefined} title={`写回评论 · #${id}`} open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Modal.Content>
        <View style={{ gap: 10 }}>
          <TextInput
            style={styles.input}
            placeholder="输入要写回 TAPD 的内容（纯文本，自动转 HTML）"
            placeholderTextColor={theme.colors.foregroundMuted}
            multiline
            value={text}
            onChangeText={setText}
          />
          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              style={[styles.primaryButton, !text.trim() || submitting ? styles.disabledButton : null]}
              disabled={!text.trim() || submitting}
              onPress={() => void submit()}
            >
              <Text style={styles.primaryLabel}>{submitting ? "提交中…" : "提交"}</Text>
            </Pressable>
          </View>
        </View>
      </Modal.Content>
    </Modal>
  );
}
