import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { imageRpc } from "../../shared/contracts";
import { tapdImagePath } from "../../shared/rich-text";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, Text, View } from "react-native";
import type { WorkbenchTheme } from "./bits";

export function ContentImage({ source, baseUrl, workspaceId, label, theme }: { source?: string; baseUrl: string; workspaceId: string; label: string; theme: WorkbenchTheme }) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [focused, setFocused] = useState("");
  const colors = theme.colors;
  const imagePath = tapdImagePath(source, baseUrl);
  const fetchImage = useRpc(imageRpc);
  const imageQuery = useQuery({
    queryKey: ["tapd-image", baseUrl, workspaceId, imagePath],
    queryFn: () => fetchImage({ workspaceId, imagePath: imagePath! }),
    enabled: !!imagePath,
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
  });
  const uri = imagePath ? imageQuery.data?.dataUri : source;
  const failed = (imageQuery.isError && !imageQuery.isFetching) || state === "error";
  const onError = useCallback(() => setState("error"), []);
  useEffect(() => {
    if (!uri) return;
    let active = true;
    Image.getSize(uri, (width, height) => {
      if (!active) return;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) { setState("error"); return; }
      setDimensions({ width, height });
      setState("loaded");
    }, () => { if (active) setState("error"); });
    return () => { active = false; };
  }, [uri, attempt]);
  if (!source) return <Text style={{ color: colors.foregroundMuted, fontSize: 13 }}>{label} · 图片地址不可用</Text>;
  return <View style={{ width: "100%", gap: 8, paddingVertical: 4 }}>
    {uri ? <Image key={attempt} source={{ uri }} accessibilityLabel={label} resizeMode="contain" onError={onError}
      style={{ display: failed ? "none" : "flex", width: "100%", maxWidth: dimensions?.width,
        aspectRatio: dimensions ? dimensions.width / dimensions.height : 16 / 9, alignSelf: "center", borderRadius: 8, backgroundColor: colors.surface1 }} /> : null}
    {!failed && state === "loading" ? <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <ActivityIndicator size="small" color={colors.accent} /><Text accessibilityLiveRegion="polite" style={{ color: colors.foregroundMuted, fontSize: 12 }}>图片加载中…</Text>
    </View> : null}
    {failed ? <Text accessibilityRole="alert" style={{ color: colors.statusDanger, fontSize: 13 }}>图片加载失败</Text> : null}
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
      {failed ? <Pressable accessibilityRole="button" accessibilityLabel={`重试加载图片：${label}`}
        onPress={() => { setState("loading"); setAttempt(value => value + 1); if (imagePath) void imageQuery.refetch(); }}
        onFocus={() => setFocused("retry")} onBlur={() => setFocused("")}
        style={{ padding: 6, borderRadius: 6, borderWidth: 1, borderColor: focused === "retry" ? colors.accent : "transparent" }}>
        <Text style={{ color: colors.accent, fontSize: 13 }}>重试</Text>
      </Pressable> : null}
    </View>
  </View>;
}
