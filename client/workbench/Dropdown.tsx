import { ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, Text, View, useWindowDimensions, type TextInput as NativeTextInput, type ViewStyle } from "react-native";
import type { WorkbenchTheme } from "./bits";

export type DropdownOption = { value: string; label: string; disabled?: boolean };
type SelectionResult = void | boolean | Promise<void | boolean>;

export type DropdownProps = {
  label: string;
  summary: string;
  options: readonly DropdownOption[];
  selected: readonly string[];
  onSelect(value: string): SelectionResult;
  multiple?: boolean;
  searchable?: boolean;
  onCustomValue?(nickname: string): SelectionResult;
  loading?: boolean;
  error?: string | null;
  onRetry?(): void;
  disabled?: boolean;
  onOpen?(): void;
  theme: WorkbenchTheme;
};

type WebKey = { key: string; preventDefault(): void; target?: { tagName?: string } };
type WebEvents = {
  addEventListener(name: "keydown", handler: (event: WebKey) => void): void;
  removeEventListener(name: "keydown", handler: (event: WebKey) => void): void;
};

export function Dropdown({ label, summary, options, selected, onSelect, multiple = false, searchable = false, onCustomValue, loading = false, error, onRetry, disabled = false, onOpen, theme }: DropdownProps) {
  const { width, height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [anchor, setAnchor] = useState({ x: 16, y: 16, height: 32 });
  const triggerRef = useRef<View>(null);
  const searchRef = useRef<NativeTextInput>(null);
  const optionRefs = useRef(new Map<string, View>());
  const activeValue = useRef<string | null>(null);
  const selecting = useRef(false);
  const colors = theme.colors;
  const nickname = search.trim().slice(0, 200);
  const visibleOptions = options.filter(option => option.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const enabledOptions = visibleOptions.filter(option => !option.disabled);
  const compact = Platform.OS !== "web" || width < 768;

  function close() {
    setOpen(false);
    setSearch("");
    // Wait until the Modal has relinquished focus before returning to the trigger.
    setTimeout(() => triggerRef.current?.focus(), 0);
  }

  async function select(value: string, custom = false) {
    if (disabled || loading || selecting.current || (!custom && !multiple && selected.includes(value))) return;
    selecting.current = true;
    setBusy(true);
    try {
      const result = await (custom ? onCustomValue?.(value) : onSelect(value));
      if (result !== false && (!multiple || custom)) close();
    } catch {
      // The caller owns safe error feedback; keep the menu available for retry.
    } finally {
      selecting.current = false;
      setBusy(false);
    }
  }

  function focusOption(value: string) {
    activeValue.current = value;
    optionRefs.current.get(value)?.focus();
  }

  useEffect(() => {
    if (!open || Platform.OS !== "web") return;
    const events = globalThis as unknown as WebEvents;
    function onKey(event: WebKey) {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "Enter" && event.target?.tagName === "INPUT") {
        if (onCustomValue && nickname && !disabled && !busy) {
          event.preventDefault();
          void select(nickname, true);
        }
        return;
      }
      if (disabled || loading || busy || enabledOptions.length === 0) return;
      const typing = event.target?.tagName === "INPUT";
      if (typing && (event.key === "Home" || event.key === "End")) return;
      const index = enabledOptions.findIndex(option => option.value === activeValue.current);
      let next = index;
      if (event.key === "ArrowDown") next = (index + 1) % enabledOptions.length;
      else if (event.key === "ArrowUp") next = index < 0 ? enabledOptions.length - 1 : (index - 1 + enabledOptions.length) % enabledOptions.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = enabledOptions.length - 1;
      else if ((event.key === "Enter" || event.key === " ") && !typing && index >= 0 && event.target === optionRefs.current.get(enabledOptions[index].value)) {
        event.preventDefault();
        void select(enabledOptions[index].value);
        return;
      } else return;
      event.preventDefault();
      focusOption(enabledOptions[next].value);
    }
    events.addEventListener("keydown", onKey);
    return () => events.removeEventListener("keydown", onKey);
  });

  const menuWidth = Math.min(320, width - 32);
  const maxHeight = Math.max(1, Math.min(440, height - 48));
  const menuStyle: ViewStyle = compact ? {
    position: "absolute", left: 12, right: 12, bottom: 24, maxHeight,
  } : {
    position: "absolute",
    width: menuWidth,
    left: Math.max(16, Math.min(anchor.x, width - menuWidth - 16)),
    top: anchor.y + anchor.height + maxHeight + 6 <= height - 16
      ? anchor.y + anchor.height + 6
      : Math.max(16, Math.min(height - maxHeight - 16, anchor.y - maxHeight - 6)),
    maxHeight,
  };
  const blocked = disabled || busy || loading;

  return (
    <>
      <Pressable
        ref={triggerRef}
        accessibilityRole="button"
        accessibilityLabel={`${label}：${summary}`}
        accessibilityState={{ expanded: open, disabled: blocked }}
        aria-expanded={open}
        aria-disabled={blocked}
        disabled={blocked}
        onPress={() => {
          onOpen?.();
          setSearch("");
          activeValue.current = null;
          triggerRef.current?.measureInWindow((x, y, _w, h) => {
            setAnchor({ x, y, height: h });
            setOpen(true);
          });
        }}
        onFocus={() => setFocused("trigger")}
        onBlur={() => setFocused(null)}
        style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: focused === "trigger" || open ? colors.accent : colors.border, borderRadius: 6, backgroundColor: colors.surface1, opacity: blocked ? 0.5 : 1, maxWidth: 280 }}
      >
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, flexShrink: 1 }}>{label}：{summary}</Text>
        <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>▾</Text>
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="none"
        onRequestClose={close}
        onShow={() => {
          if (searchable) searchRef.current?.focus();
          else {
            const initial = enabledOptions.find(option => selected.includes(option.value)) ?? enabledOptions[0];
            if (initial) focusOption(initial.value);
          }
        }}
      >
        <View style={{ flex: 1 }} accessibilityViewIsModal>
          <Pressable accessibilityRole="button" accessibilityLabel={`关闭${label}菜单`} onPress={close} style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: compact ? colors.foreground : "transparent", opacity: compact ? 0.2 : 1 }} />
          <View role="dialog" accessibilityLabel={`${label}选项`} style={[menuStyle, { backgroundColor: colors.surface0, borderWidth: 1, borderColor: colors.border, borderRadius: 10, overflow: "hidden" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600", flex: 1 }}>{label}</Text>
              {busy ? <ActivityIndicator color={colors.accent} size="small" /> : null}
              <Pressable accessibilityRole="button" accessibilityLabel={`关闭${label}菜单`} onPress={close} onFocus={() => setFocused("close")} onBlur={() => setFocused(null)} style={{ padding: 6, borderRadius: 4, backgroundColor: focused === "close" ? colors.surface2 : "transparent" }}>
                <Text style={{ color: colors.foregroundMuted }}>×</Text>
              </Pressable>
            </View>
            {searchable ? <TextInput ref={searchRef} accessibilityLabel={`搜索${label}`} placeholder={onCustomValue ? "搜索；或输入准确昵称" : "搜索选项"} placeholderTextColor={colors.foregroundMuted} value={search} maxLength={200} onChangeText={setSearch} editable={!blocked} style={{ margin: 8, padding: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 6, color: colors.foreground, fontSize: 13 }} /> : null}
            <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
              {loading ? <View style={{ padding: 12, flexDirection: "row", gap: 8 }}><ActivityIndicator color={colors.accent} size="small" /><Text style={{ color: colors.foregroundMuted }}>正在加载…</Text></View> : null}
              {error ? <View style={{ padding: 12, gap: 6 }}><Text accessibilityRole="alert" style={{ color: colors.statusDanger, fontSize: 12 }}>{error}</Text>{onRetry ? <Pressable accessibilityRole="button" disabled={blocked || loading} onPress={onRetry} onFocus={() => setFocused("retry")} onBlur={() => setFocused(null)} style={{ paddingVertical: 6, backgroundColor: focused === "retry" ? colors.surface2 : "transparent" }}><Text style={{ color: colors.accent }}>重试</Text></Pressable> : null}</View> : null}
              <View role="menu" accessibilityLabel={label}>
                {visibleOptions.map(option => (
                  <Pressable
                    key={option.value}
                    ref={node => { if (node) optionRefs.current.set(option.value, node); else optionRefs.current.delete(option.value); }}
                    role={(Platform.OS === "web" ? multiple ? "menuitemcheckbox" : "menuitemradio" : "menuitem") as "menuitem"}
                    aria-checked={selected.includes(option.value)}
                    accessibilityLabel={option.label}
                    accessibilityState={{ selected: selected.includes(option.value), disabled: blocked || option.disabled }}
                    disabled={blocked || option.disabled}
                    onFocus={() => { activeValue.current = option.value; setFocused(`option:${option.value}`); }}
                    onBlur={() => setFocused(null)}
                    onPress={() => void select(option.value)}
                    style={{ paddingHorizontal: 12, paddingVertical: 11, flexDirection: "row", gap: 8, backgroundColor: focused === `option:${option.value}` ? colors.surface2 : selected.includes(option.value) ? colors.surface1 : "transparent", borderWidth: 1, borderColor: focused === `option:${option.value}` ? colors.accent : "transparent", opacity: blocked || option.disabled ? 0.5 : 1 }}
                  >
                    <Text style={{ width: 14, color: colors.accent }}>{selected.includes(option.value) ? "✓" : ""}</Text>
                    <Text style={{ flexShrink: 1, color: colors.foreground, fontSize: 13 }}>{option.label}</Text>
                  </Pressable>
                ))}
              </View>
              {!loading && !visibleOptions.length ? <Text style={{ padding: 12, color: colors.foregroundMuted, fontSize: 12 }}>{search.trim() ? "没有匹配的选项" : "暂无可选项"}</Text> : null}
              {onCustomValue && nickname ? <Pressable accessibilityRole="button" accessibilityLabel={`使用准确昵称：${nickname}`} disabled={blocked} onPress={() => void select(nickname, true)} onFocus={() => setFocused("custom")} onBlur={() => setFocused(null)} style={{ padding: 12, borderTopWidth: 1, borderColor: colors.border, backgroundColor: focused === "custom" ? colors.surface2 : colors.surface1 }}><Text style={{ color: colors.accent, fontSize: 13 }}>使用准确昵称：{nickname}</Text></Pressable> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
