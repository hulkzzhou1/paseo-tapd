import { openExternalUrl } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, Text, View } from "react-native";
import type { WorkbenchTheme } from "./bits";

export function ContentImage({ source, label, theme }: { source?: string; label: string; theme: WorkbenchTheme }) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [focused, setFocused] = useState("");
  const colors = theme.colors;
  const onError = useCallback(() => setState("error"), []);
  useEffect(() => {
    if (!source) return;
    let active = true;
    Image.getSize(source, (width, height) => {
      if (!active) return;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) { setState("error"); return; }
      setDimensions({ width, height });
      setState("loaded");
    }, () => { if (active) setState("error"); });
    return () => { active = false; };
  }, [source, attempt]);
  if (!source) return <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>{label} · 图片地址不可用</Text>;
  return <View style={{ width: "100%", gap: 8, paddingVertical: 4 }}>
    <Image key={attempt} source={{ uri: source }} accessibilityLabel={label} resizeMode="contain" onError={onError}
      style={{ display: state === "error" ? "none" : "flex", width: "100%", maxWidth: dimensions?.width,
        aspectRatio: dimensions ? dimensions.width / dimensions.height : 16 / 9, alignSelf: "center", borderRadius: 8, backgroundColor: colors.surface1 }} />
    {state === "loading" ? <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <ActivityIndicator size="small" color={colors.accent} /><Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted, fontSize: 12 }}>图片加载中…</Text>
    </View> : null}
    {state === "error" ? <Text accessibilityRole="alert" style={{ color: colors.statusDanger, fontSize: 13 }}>图片加载失败</Text> : null}
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
      <Text style={{ color: colors.foregroundMuted, fontSize: 12 }}>{label}</Text>
      <Pressable accessibilityRole="link" accessibilityLabel={`查看原图：${label}`} onPress={() => void openExternalUrl(source)}
        {...(Platform.OS === "web" ? { onKeyDown: (event: { key: string; preventDefault(): void }) => {
          if (event.key === "Enter") { event.preventDefault(); void openExternalUrl(source); }
        } } : {})}
        onFocus={() => setFocused("original")} onBlur={() => setFocused("")}
        style={{ padding: 6, borderRadius: 6, borderWidth: 1, borderColor: focused === "original" ? colors.accent : "transparent" }}>
        <Text style={{ color: colors.accent, fontSize: 13 }}>查看原图</Text>
      </Pressable>
      {state === "error" ? <Pressable accessibilityRole="button" accessibilityLabel={`重试加载图片：${label}`}
        onPress={() => { setState("loading"); setAttempt(value => value + 1); }}
        onFocus={() => setFocused("retry")} onBlur={() => setFocused("")}
        style={{ padding: 6, borderRadius: 6, borderWidth: 1, borderColor: focused === "retry" ? colors.accent : "transparent" }}>
        <Text style={{ color: colors.accent, fontSize: 13 }}>重试</Text>
      </Pressable> : null}
    </View>
  </View>;
}
