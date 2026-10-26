import { openExternalUrl } from "@getpaseo/plugin/client";
import { useMemo, type ReactNode } from "react";
import { Platform, ScrollView, Text, View, type TextStyle } from "react-native";
import { parseRichText, type RichNode } from "../../shared/rich-text";
import type { WorkbenchTheme } from "./bits";

export function RichText({ html, text, baseUrl, theme }: { html?: string; text: string; baseUrl: string; theme: WorkbenchTheme }) {
  const nodes = useMemo(() => html ? parseRichText(html, baseUrl) : null, [html, baseUrl]);
  const colors = theme.colors;
  const body: TextStyle = { color: colors.foreground, fontSize: 15, lineHeight: 26 };
  const mono = Platform.OS === "ios" ? "Menlo" : "monospace";
  function inline(node: RichNode, key: number): ReactNode {
    if (node.tag === "text") return node.text;
    if (node.tag === "br") return "\n";
    if (node.tag === "img") return <Text key={key} accessibilityRole={node.href ? "link" : undefined} onPress={node.href ? () => void openExternalUrl(node.href!) : undefined} style={{ color: node.href ? colors.accent : colors.foregroundMuted }}>{`[${node.text || "图片"}${node.href ? " · 查看原图" : ""}]`}</Text>;
    const style: TextStyle = node.tag === "strong" || node.tag === "b" ? { fontWeight: "700" }
      : node.tag === "em" || node.tag === "i" ? { fontStyle: "italic" }
      : node.tag === "code" ? { fontFamily: mono, backgroundColor: colors.surface2 }
      : node.tag === "s" ? { textDecorationLine: "line-through" }
      : node.tag === "u" ? { textDecorationLine: "underline" } : {};
    return <Text key={key} style={[style, node.tag === "a" && node.href ? { color: colors.accent, textDecorationLine: "underline" } : null]}
      accessibilityRole={node.tag === "a" && node.href ? "link" : undefined}
      onPress={node.tag === "a" && node.href ? () => void openExternalUrl(node.href!) : undefined}>{node.children.map(inline)}</Text>;
  }
  function render(node: RichNode, key: number): ReactNode {
    if (node.tag === "text" && !node.text?.trim()) return null;
    if (node.tag === "ul" || node.tag === "ol") {
      let number = 0;
      return <View key={key} style={{ gap: 8, paddingLeft: 8 }}>{node.children.map((child, index) => child.tag === "li" ? <View key={index} style={{ flexDirection: "row", gap: 10 }}><Text style={body}>{node.tag === "ol" ? `${++number}.` : "•"}</Text><View style={{ flex: 1, minWidth: 0, gap: 6 }}>{child.children.map(render)}</View></View> : render(child, index))}</View>;
    }
    if (node.tag === "table") return <ScrollView key={key} horizontal style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}><View>{node.children.map(render)}</View></ScrollView>;
    if (["thead", "tbody", "tfoot"].includes(node.tag)) return <View key={key}>{node.children.map(render)}</View>;
    if (node.tag === "tr") return <View key={key} style={{ flexDirection: "row" }}>{node.children.filter(child => child.tag === "td" || child.tag === "th").map((cell, index) => <View key={index} style={{ width: 200, padding: 12, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: cell.tag === "th" ? colors.surface1 : colors.surface0 }}><Text selectable style={[body, cell.tag === "th" ? { fontWeight: "600" } : null]}>{cell.children.map(inline)}</Text></View>)}</View>;
    if (node.tag === "pre") return <ScrollView key={key} horizontal style={{ backgroundColor: colors.surface1, borderRadius: 8 }} contentContainerStyle={{ padding: 16 }}><Text selectable style={{ color: colors.foreground, fontFamily: mono, fontSize: 13, lineHeight: 22 }}>{node.children.map(inline)}</Text></ScrollView>;
    if (node.tag === "blockquote") return <View key={key} style={{ borderLeftWidth: 3, borderColor: colors.border, paddingLeft: 16, gap: 8 }}>{node.children.map(render)}</View>;
    if (node.tag === "hr") return <View key={key} style={{ height: 1, backgroundColor: colors.border, marginVertical: 8 }} />;
    if (node.tag === "div" || node.tag === "li") return <View key={key} style={{ gap: 10 }}>{node.children.map(render)}</View>;
    const heading = /^h[1-6]$/.test(node.tag);
    return <Text key={key} selectable accessibilityRole={heading ? "header" : undefined} style={[body, heading ? { fontSize: ["h1", "h2"].includes(node.tag) ? 21 : 17, lineHeight: 30, fontWeight: "600", marginTop: 12 } : null]}>{node.tag === "text" ? node.text : node.tag === "p" || heading ? node.children.map(inline) : inline(node, key)}</Text>;
  }
  return <View style={{ gap: 16, width: "100%", maxWidth: 760, alignSelf: "center" }}>
    {nodes ? nodes.map(render) : <Text selectable style={body}>{text || "（无内容）"}</Text>}
  </View>;
}
