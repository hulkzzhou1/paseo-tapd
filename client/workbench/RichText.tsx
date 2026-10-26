import { openExternalUrl } from "@getpaseo/plugin/client";
import { useMemo, useState, type ReactNode } from "react";
import { Platform, ScrollView, Text, View, type TextStyle } from "react-native";
import { parseRichText, type RichNode } from "../../shared/rich-text";
import { ContentImage } from "./ContentImage";
import type { WorkbenchTheme } from "./bits";

type InlineNode = RichNode & { original?: RichNode };

/** Split inline runs around images, preserving ancestor formatting in the remaining text. */
function imageRuns(nodes: InlineNode[]): InlineNode[] {
  const runs: InlineNode[] = [];
  let text: InlineNode[] = [];
  function flush() { if (text.length) { runs.push({ tag: "run", children: text }); text = []; } }
  for (const node of nodes) {
    if (node.tag === "img") { flush(); runs.push(node); }
    else if (node.children.length) {
      for (const part of imageRuns(node.children)) {
        if (part.tag === "img") { flush(); runs.push(part); }
        else text.push({ ...node, original: node.original ?? node, children: part.children });
      }
    } else text.push(node);
  }
  flush();
  return runs;
}

export function RichText({ html, text, baseUrl, theme }: { html?: string; text: string; baseUrl: string; theme: WorkbenchTheme }) {
  const nodes = useMemo(() => html ? parseRichText(html, baseUrl) : null, [html, baseUrl]);
  const [focused, setFocused] = useState<RichNode | null>(null);
  const colors = theme.colors;
  function linkProps(node: InlineNode) {
    return {
      accessibilityRole: node.href ? "link" as const : undefined,
      onPress: node.href ? () => void openExternalUrl(node.href!) : undefined,
      onFocus: () => setFocused(node.original ?? node),
      onBlur: () => setFocused(null),
      ...(Platform.OS === "web" && node.href ? {
        tabIndex: 0,
        onKeyDown: (event: { key: string; preventDefault(): void }) => {
          if (event.key === "Enter") { event.preventDefault(); void openExternalUrl(node.href!); }
        },
      } : {}),
    };
  }
  const body: TextStyle = { color: colors.foreground, fontSize: 15, lineHeight: 26 };
  const mono = Platform.OS === "ios" ? "Menlo" : "monospace";
  function inline(node: InlineNode, key: number): ReactNode {
    if (node.tag === "text") return node.text;
    if (node.tag === "br") return "\n";
    const style: TextStyle = node.tag === "strong" || node.tag === "b" ? { fontWeight: "700" }
      : node.tag === "em" || node.tag === "i" ? { fontStyle: "italic" }
      : node.tag === "code" ? { fontFamily: mono, backgroundColor: colors.surface2 }
      : node.tag === "s" ? { textDecorationLine: "line-through" }
      : node.tag === "u" ? { textDecorationLine: "underline" } : {};
    return <Text key={key} style={[style, node.tag === "a" && node.href ? { color: colors.accent, textDecorationLine: "underline", backgroundColor: focused === (node.original ?? node) ? colors.surface2 : undefined } : null]}
      {...(node.tag === "a" ? linkProps(node) : {})}>{node.children.map(inline)}{node.tag === "p" || node.tag === "div" ? "\n" : null}</Text>;
  }
  function flow(nodes: RichNode[], key: number, style: TextStyle = body, heading = false): ReactNode {
    return <View key={key} style={{ width: "100%", gap: 12 }}>{imageRuns(nodes).map((run, index) => run.tag === "img"
      ? <ContentImage key={`${index}-${run.href}`} source={run.href} label={run.text || "图片"} theme={theme} />
      : <Text key={index} selectable accessibilityRole={heading ? "header" : undefined} style={style}>{run.children.map(inline)}</Text>)}</View>;
  }
  function render(node: RichNode, key: number): ReactNode {
    if (node.tag === "img") return <ContentImage key={`${key}-${node.href}`} source={node.href} label={node.text || "图片"} theme={theme} />;
    if (node.tag === "text" && !node.text?.trim()) return null;
    if (node.tag === "ul" || node.tag === "ol") {
      let number = 0;
      return <View key={key} style={{ gap: 8, paddingLeft: 8 }}>{node.children.map((child, index) => child.tag === "li" ? <View key={index} style={{ flexDirection: "row", gap: 10 }}><Text style={body}>{node.tag === "ol" ? `${++number}.` : "•"}</Text><View style={{ flex: 1, minWidth: 0, gap: 6 }}>{child.children.map(render)}</View></View> : render(child, index))}</View>;
    }
    if (node.tag === "table") return <ScrollView key={key} horizontal style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8 }}><View>{node.children.map(render)}</View></ScrollView>;
    if (["thead", "tbody", "tfoot"].includes(node.tag)) return <View key={key}>{node.children.map(render)}</View>;
    if (node.tag === "tr") return <View key={key} style={{ flexDirection: "row" }}>{node.children.filter(child => child.tag === "td" || child.tag === "th").map((cell, index) => <View key={index} style={{ width: 200, padding: 12, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: cell.tag === "th" ? colors.surface1 : colors.surface0 }}>{flow(cell.children, index, { ...body, fontWeight: cell.tag === "th" ? "600" : "400" })}</View>)}</View>;
    if (node.tag === "pre") return <View key={key} style={{ gap: 12 }}>{imageRuns(node.children).map((run, index) => run.tag === "img" ? render(run, index) : <ScrollView key={index} horizontal style={{ backgroundColor: colors.surface1, borderRadius: 8 }} contentContainerStyle={{ padding: 16 }}><Text selectable style={{ color: colors.foreground, fontFamily: mono, fontSize: 13, lineHeight: 22 }}>{run.children.map(inline)}</Text></ScrollView>)}</View>;
    if (node.tag === "blockquote") return <View key={key} style={{ borderLeftWidth: 3, borderColor: colors.border, paddingLeft: 16, gap: 8 }}>{node.children.map(render)}</View>;
    if (node.tag === "hr") return <View key={key} style={{ height: 1, backgroundColor: colors.border, marginVertical: 8 }} />;
    if (node.tag === "div" || node.tag === "li") return <View key={key} style={{ gap: 10 }}>{node.children.map(render)}</View>;
    const heading = /^h[1-6]$/.test(node.tag);
    if (node.tag === "p" || heading) return flow(node.children, key, { ...body, ...(heading ? { fontSize: ["h1", "h2"].includes(node.tag) ? 21 : 17, lineHeight: 30, fontWeight: "600" as const, marginTop: 12 } : {}) }, heading);
    if (node.children.length) return flow([node], key);
    return <Text key={key} selectable style={body}>{node.tag === "text" ? node.text : inline(node, key)}</Text>;
  }
  return <View style={{ gap: 16, width: "100%", maxWidth: 760, alignSelf: "center" }}>
    {nodes ? nodes.map(render) : <Text selectable style={body}>{text || "（无内容）"}</Text>}
  </View>;
}
