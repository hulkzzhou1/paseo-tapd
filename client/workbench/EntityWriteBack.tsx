import { useRpc } from "@getpaseo/plugin/client";
import { Modal, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View, type TextStyle, type ViewStyle } from "react-native";
import { addCommentRpc, statusOptionsRpc, updateStatusRpc, type EntityKind } from "../../shared/contracts";
import { type WorkbenchTheme } from "./bits";
import { Dropdown } from "./Dropdown";

/** 选中即写回，候选只来自单据所属项目和类型。 */
export function StatusDropdown({ theme, kind, id, workspaceId, current, currentLabel, onDone }: {
  theme: WorkbenchTheme;
  kind: EntityKind;
  id: string;
  /** 单据实际所在项目（多项目配置时保证回写正确） */
  workspaceId: string;
  current: string;
  currentLabel: string;
  onDone: () => void;
}) {
  const fetchOptions = useRpc(statusOptionsRpc);
  const updateStatus = useRpc(updateStatusRpc);
  const toast = useToast();
  const [opened, setOpened] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [writeError, setWriteError] = useState("");

  const optionsQuery = useQuery({
    queryKey: ["tapd-status-options", workspaceId, kind],
    queryFn: () => fetchOptions({ kind, workspaceId }),
    enabled: opened,
    staleTime: 600_000,
    retry: false,
  });

  const options = optionsQuery.data?.options ?? [];

  async function apply(value: string) {
    if (submittingRef.current || value === current) return false;
    submittingRef.current = true;
    setSubmitting(true);
    setWriteError("");
    try {
      await updateStatus({ kind, id, status: value, workspaceId });
    } catch {
      setWriteError("修改状态失败，请重试。");
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
      onOpen={() => setOpened(true)}
      loading={opened && optionsQuery.isFetching}
      disabled={submitting || !workspaceId}
      error={writeError || (optionsQuery.isError ? "读取状态选项失败，请重试。" : null)}
      onRetry={optionsQuery.isError ? () => void optionsQuery.refetch() : undefined}
      theme={theme}
    />
  );
}

/** 写回评论（纯文本自动转 HTML） */
export function CommentModal({ open, onClose, theme, kind, id, workspaceId, onDone }: {
  open: boolean;
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
    input: {
      backgroundColor: theme.colors.surface2,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      color: theme.colors.foreground,
      fontSize: 13,
      minHeight: 120,
      textAlignVertical: "top",
    },
    footer: { flexDirection: "row", justifyContent: "flex-end", gap: 8, paddingTop: 8 },
    primaryButton: { backgroundColor: theme.colors.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
    primaryLabel: { color: theme.colors.accentForeground, fontSize: 13 },
    disabledButton: { opacity: 0.5 },
  }), [theme]);

  return (
    <Modal title={`写回评论 · #${id}`} open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
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
