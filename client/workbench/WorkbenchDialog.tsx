import { Icon } from "@getpaseo/plugin/client/react-native";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions, type TextStyle, type ViewStyle } from "react-native";
import type { WorkbenchTheme } from "./bits";

const DialogTheme = createContext<WorkbenchTheme | null>(null);

export function WorkbenchDialog({ title, open, onOpenChange, theme, children, size = "form", onBack, dirty = false, pending = false, onDismiss }: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: WorkbenchTheme;
  children: ReactNode;
  size?: "small" | "form" | "reading" | "settings";
  onBack?: () => void;
  dirty?: boolean;
  pending?: boolean;
  onDismiss?: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const [discard, setDiscard] = useState(false);
  const [back, setBack] = useState(false);
  const [focused, setFocused] = useState("");
  const colors = theme.colors;
  const compact = width < 768;
  function requestClose(returning = false) {
    if (pending) return;
    if (dirty) { setBack(returning); setDiscard(true); return; }
    if (returning && onBack) onBack(); else onOpenChange(false);
  }
  const targetWidth = { small: 520, form: 800, reading: 1040, settings: 900 }[size];
  return <Modal onDismiss={onDismiss} accessibilityLabel={title} visible={open} transparent animationType="none" onRequestClose={() => {
    if (discard) setDiscard(false); else requestClose();
  }}>
    <DialogTheme.Provider value={theme}>
      <View style={{ flex: 1, justifyContent: compact ? "flex-end" : "center", alignItems: "center", padding: compact ? 8 : 24 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`关闭${title}`} onPress={() => requestClose()}
          style={{ position: "absolute", inset: 0, backgroundColor: colors.foreground, opacity: 0.3 }} />
        <View testID="workbench-dialog-panel" accessibilityViewIsModal
          style={{ width: Math.min(targetWidth, width - (compact ? 16 : 48)), maxHeight: height - (compact ? 16 : 48), backgroundColor: colors.surface0, borderWidth: 1, borderColor: colors.border, borderRadius: 16, overflow: "hidden" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: compact ? 16 : 24, paddingVertical: 14, borderBottomWidth: 1, borderColor: colors.border }}>
            {onBack ? <Pressable accessibilityRole="button" accessibilityLabel="返回详情" onFocus={() => setFocused("back")} onBlur={() => setFocused("")} disabled={pending} onPress={() => requestClose(true)} style={{ padding: 8, borderRadius: 8, borderWidth: 1, borderColor: focused === "back" ? colors.accent : "transparent" }}>
              <Icon name="ArrowLeft" size={18} color={colors.foregroundMuted} />
            </Pressable> : null}
            <Text accessibilityRole="header" numberOfLines={2} style={{ flex: 1, color: colors.foreground, fontSize: 18, lineHeight: 26, fontWeight: "600" }}>{title}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`关闭${title}`} disabled={pending} onFocus={() => setFocused("close")} onBlur={() => setFocused("")} onPress={() => requestClose()} style={{ padding: 10, borderRadius: 8, borderWidth: 1, borderColor: focused === "close" ? colors.accent : "transparent" }}>
              <Icon name="X" size={20} color={colors.foregroundMuted} />
            </Pressable>
          </View>
          <View style={{ display: discard ? "none" : "flex", flexShrink: 1, minHeight: 0 }}>{children}</View>
          {discard ? <View style={{ padding: 24, gap: 20 }}>
            <Text accessibilityRole="alert" style={{ color: colors.foreground, fontSize: 15, lineHeight: 24 }}>放弃尚未提交的内容？</Text>
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 12 }}>
              <Pressable accessibilityRole="button" onFocus={() => setFocused("continue")} onBlur={() => setFocused("")} onPress={() => setDiscard(false)} style={{ padding: 12, borderRadius: 8, borderWidth: 1, borderColor: focused === "continue" ? colors.accent : "transparent" }}><Text style={{ color: colors.foreground }}>继续编辑</Text></Pressable>
              <Pressable accessibilityRole="button" onFocus={() => setFocused("discard")} onBlur={() => setFocused("")} onPress={() => { setDiscard(false); if (back && onBack) onBack(); else onOpenChange(false); }} style={{ padding: 12, borderRadius: 8, borderWidth: 1, borderColor: focused === "discard" ? colors.foreground : "transparent", backgroundColor: colors.accent }}><Text style={{ color: colors.accentForeground }}>放弃修改</Text></Pressable>
            </View>
          </View> : null}
        </View>
      </View>
    </DialogTheme.Provider>
  </Modal>;
}

function Content({ children, scrollable = true, style, contentContainerStyle }: {
  children: ReactNode;
  scrollable?: boolean;
  style?: ViewStyle;
  contentContainerStyle?: ViewStyle;
}) {
  const { width, height } = useWindowDimensions();
  const theme = useContext(DialogTheme);
  const padding = width < 768 ? 16 : 24;
  if (!scrollable) return <View style={[{ flexShrink: 1, minHeight: 0, height: Math.min(520, height - 150), padding, gap: 16, backgroundColor: theme?.colors.surface0 }, style, contentContainerStyle]}>{children}</View>;
  return <ScrollView style={[{ flexShrink: 1 }, style]} keyboardShouldPersistTaps="handled" contentContainerStyle={[{ padding, gap: 16 }, contentContainerStyle]}>{children}</ScrollView>;
}
WorkbenchDialog.Content = Content;

export function dialogFormStyles(theme: WorkbenchTheme): { input: TextStyle; primaryButton: ViewStyle; primaryLabel: TextStyle; footer: ViewStyle } {
  const colors = theme.colors;
  return {
    input: { backgroundColor: colors.surface1, borderColor: colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, minHeight: 42, color: colors.foreground, fontSize: 14, lineHeight: 22 },
    primaryButton: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 11, alignItems: "center" },
    primaryLabel: { color: colors.accentForeground, fontSize: 14, fontWeight: "600" },
    footer: { flexDirection: "row", justifyContent: "flex-end", gap: 12, paddingTop: 20, borderTopWidth: 1, borderColor: colors.border },
  };
}
