import { StoryShortFields } from "./StoryShortFields";
import { toolLinkSchema } from "../../shared/agent-links";
import { EntityLabels } from "./EntityLabels";
import { RichText } from "./RichText";
import type { RpcOutput } from "@getpaseo/plugin";
import { openExternalUrl, usePaseo, useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View, useWindowDimensions, type TextStyle, type ViewStyle } from "react-native";
import { agentStatusRpc, entityRpc, type EntityKind, type TapdLink } from "../../shared/contracts";
import { Chip, agentStatusColor, formatTime, formatIsoTime, type WorkbenchTheme } from "./bits";
import { priorityTone, statusTone, toneColor } from "./status-tones";
import { StatusDropdown, type StatusChangeTarget } from "./EntityWriteBack";
import { subscribeBoardUpdates } from "../conversation/board-updates";

export interface DetailTarget {
  kind: EntityKind;
  id: string;
  title: string;
  workspaceId?: string;
  siteUrl?: string;
  apiEndpoint?: string;
}

export type EntityDetailData = RpcOutput<typeof entityRpc>;
export type AgentStatusItem = NonNullable<RpcOutput<typeof agentStatusRpc>["items"]>[number];

export interface DetailExtras {
  onRemoveFromConversation?: () => void;
  links: readonly TapdLink[];
  navigation?: PluginScreenProps["navigation"];
  refreshToken: number;
  onLinkCreated?: (input: { link: TapdLink; repoPath?: string; provider?: string }) => void;
  onBindAgent?: (data: EntityDetailData) => void;
  onRemoveLink?: (link: TapdLink) => void;
  onTransferLink?: (link: TapdLink, data: EntityDetailData) => void;
  onDispatch?: (data: EntityDetailData) => void;
  onComment?: (data: EntityDetailData) => void;
  onStatusDone?: () => void;
  onTransition?: (target: StatusChangeTarget) => void;
  /** 需求详情：一键创建挂在该需求下的任务/缺陷 */
  onCreateChild?: (data: EntityDetailData, childKind: EntityKind) => void;
  /** 在详情面板中打开另一个单据（点击需求下的任务/缺陷行） */
  onOpenEntity?: (target: DetailTarget) => void;
}

export function EntityDetailContent({ target, theme, extras, hidden = false, readingPosition }: {
  target: DetailTarget | null;
  theme: WorkbenchTheme;
  extras: DetailExtras;
  hidden?: boolean;
  readingPosition?: RefObject<{ key: string; offset: number }>;
}) {
  const localPosition = useRef({ key: "", offset: 0 });
  const position = readingPosition ?? localPosition;
  const scroll = useRef<ScrollView>(null);
  const restoring = useRef(true);
  const [panelWidth, setPanelWidth] = useState<number>();
  useEffect(() => {
    const key = `${target?.siteUrl}:${target?.apiEndpoint}:${target?.workspaceId}:${target?.kind}:${target?.id}`;
    if (position.current.key !== key) position.current = { key, offset: 0 };
  }, [target?.siteUrl, target?.apiEndpoint, target?.workspaceId, target?.kind, target?.id, position]);
  useEffect(() => { restoring.current = true; }, [hidden]);
  return <View onLayout={event => setPanelWidth(event.nativeEvent.layout.width)} style={{ flexShrink: 1, minHeight: 0, backgroundColor: theme.colors.surface0, display: hidden ? "none" : "flex" }}>
    <ScrollView ref={scroll} style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 24 }}
      scrollEventThrottle={16} onScroll={event => { if (!restoring.current) position.current.offset = event.nativeEvent.contentOffset.y; }}
      onContentSizeChange={() => { scroll.current?.scrollTo({ y: position.current.offset, animated: false }); restoring.current = false; }}>
      <DetailBody target={target} theme={theme} extras={extras} panelWidth={panelWidth} />
    </ScrollView>
  </View>;
}

function DetailBody({ target, theme, extras, panelWidth }: { target: DetailTarget | null; theme: WorkbenchTheme; extras: DetailExtras; panelWidth?: number }) {
  const window = useWindowDimensions();
  const width = panelWidth ?? window.width;
  const open = target !== null;
  const kind = target?.kind ?? "story";
  const id = target?.id ?? "";
  const rpc = useRpc(entityRpc);
  const toast = useToast();

  const detail = useQuery({
    queryKey: ["tapd-entity", kind, id, target?.workspaceId, target?.siteUrl, target?.apiEndpoint, extras.refreshToken],
    queryFn: () => rpc({ kind, id, workspaceId: target?.workspaceId, siteUrl: target?.siteUrl, apiEndpoint: target?.apiEndpoint, fresh: true }),
    enabled: open && id.length > 0,
    staleTime: target?.siteUrl ? 0 : 60_000,
    retry: 1,
  });

  const refetchDetail = detail.refetch;
  useEffect(() => subscribeBoardUpdates(changed => {
    if (open && (!changed.kind || changed.kind === kind) && (!changed.id || changed.id === id)
      && (!changed.workspaceId || !target?.workspaceId || changed.workspaceId === target.workspaceId)
      && (!changed.apiEndpoint || !target?.apiEndpoint || changed.apiEndpoint === target.apiEndpoint)
      && (!changed.siteUrl || !target?.siteUrl || changed.siteUrl === target.siteUrl)) void refetchDetail();
  }), [open, kind, id, target?.workspaceId, target?.apiEndpoint, target?.siteUrl, refetchDetail]);

  const agentIds = useMemo(() => {
    if (!open || id === "") return [];
    return [
      ...new Set(
        extras.links
          .filter((link) => link.key === `${kind}-${id}` && link.agentId.trim().length > 0)
          .map((link) => link.agentId),
      ),
    ];
  }, [open, id, kind, extras.links]);

  const statusRpc = useRpc(agentStatusRpc);
  const paseo = usePaseo();
  const [agentStatusMap, setAgentStatusMap] = useState<Map<string, AgentStatusItem>>(new Map());
  const lastStatusFetch = useRef(0);

  const fetchAgentStatus = useCallback(() => {
    if (agentIds.length === 0) return;
    lastStatusFetch.current = Date.now();
    void statusRpc({ agentIds })
      .then((result) => {
        const next = new Map<string, AgentStatusItem>();
        for (const item of result.items ?? []) next.set(item.agentId, item);
        setAgentStatusMap(next);
      })
      .catch(() => {
        // 状态查询失败不影响详情其余内容
      });
  }, [agentIds, statusRpc]);

  // 打开面板 / 关联变化时取一次
  useEffect(() => {
    if (agentIds.length === 0) {
      setAgentStatusMap(new Map());
      return;
    }
    fetchAgentStatus();
  }, [agentIds, fetchAgentStatus]);

  // agent 事件流 → 节流重拉（实时状态点）
  useEffect(() => {
    if (agentIds.length === 0) return;
    return paseo.agents.subscribe(() => {
      if (Date.now() - lastStatusFetch.current < 2000) return;
      fetchAgentStatus();
    });
  }, [paseo, agentIds, fetchAgentStatus]);

  const styles = useMemo<{
    actions: ViewStyle;
    action: ViewStyle;
    actionLabel: TextStyle;
    title: TextStyle;
    metaRow: ViewStyle;
    metaLabel: TextStyle;
    metaValue: TextStyle;
    section: TextStyle;
    linkRow: ViewStyle;
    linkTitle: TextStyle;
    childMeta: TextStyle;
    linkAction: TextStyle;
    linkDanger: TextStyle;
    box: ViewStyle;
    description: TextStyle;
    comment: ViewStyle;
    commentHead: TextStyle;
    error: TextStyle;
    center: ViewStyle;
  }>(() => ({
    actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    action: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: theme.colors.surface2,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 7,
    },
    actionLabel: { color: theme.colors.foreground, fontSize: 13 },
    title: { color: theme.colors.foreground, fontSize: 23, lineHeight: 32, fontWeight: "600" },
    metaRow: { flexDirection: "row", gap: 8, alignItems: "flex-start", width: width >= 900 ? "48%" : "100%" },
    metaLabel: { color: theme.colors.foregroundMuted, fontSize: 12, width: 64 },
    metaValue: { color: theme.colors.foreground, fontSize: 13, lineHeight: 21, flex: 1 },
    section: { color: theme.colors.foreground, fontSize: 16, lineHeight: 24, fontWeight: "600", marginTop: 16 },
    linkRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: theme.colors.surface0,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    linkTitle: { color: theme.colors.foreground, fontSize: 12, flexShrink: 1 },
    childMeta: { color: theme.colors.foregroundMuted, fontSize: 11 },
    linkAction: { color: theme.colors.accent, fontSize: 12 },
    linkDanger: { color: theme.colors.statusDanger, fontSize: 12 },
    box: {
      backgroundColor: theme.colors.surface0,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 10,
      gap: 6,
    },
    description: { color: theme.colors.foreground, fontSize: 13, lineHeight: 20 },
    comment: {
      backgroundColor: theme.colors.surface0,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 10,
      gap: 4,
    },
    commentHead: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 20 },
    error: { color: theme.colors.statusDanger, fontSize: 13, lineHeight: 19 },
    center: { alignItems: "center", padding: 24 },
  }), [theme, width]);

  const data = detail.data;

  function metaRow(label: string, value: string | null) {
    if (!value) return null;
    return (
      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>{label}</Text>
        <Text style={styles.metaValue}>{value}</Text>
      </View>
    );
  }

  async function copyLink(url: string) {
    try {
      await copyText(url);
      toast.show("链接已复制", { variant: "success" });
    } catch {
      toast.error("复制失败");
    }
  }

  const removeAction = extras.onRemoveFromConversation ? <Pressable accessibilityRole="button" style={styles.action} onPress={extras.onRemoveFromConversation}>
    <Text style={styles.actionLabel}>从会话移除</Text>
  </Pressable> : null;

  if (detail.isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.foreground} />
        {removeAction}
      </View>
    );
  }
  if (detail.isError) {
    return (
      <View style={{ gap: 12 }}>
        <Text style={styles.error}>单据 #{id} 加载失败，请检查 TAPD 连接及访问权限后重试。</Text>
        {removeAction}
        <Pressable accessibilityRole="button" accessibilityLabel="重试加载单据" onPress={() => void detail.refetch()} style={styles.action}>
          <Text style={styles.actionLabel}>重试</Text>
        </Pressable>
      </View>
    );
  }
  if (!data) return null;

  const tone = statusTone(data.kind, data.status, data.statusLabel);
  const entityLinks = extras.links.filter(link => link.key === `${data.kind}-${data.id}`);
  const hasAgent = entityLinks.some(link => link.agentId.trim().length > 0);

  return (
    <View style={{ gap: 18 }}>
      <Text accessibilityRole="header" style={styles.title}>{data.title}</Text>
      <View style={styles.actions}>
        {!hasAgent && <>
          <Pressable accessibilityRole="button" style={styles.action} onPress={() => extras.onDispatch?.(data)}>
            <Icon name="Bot" size={14} color={theme.colors.foreground} />
            <Text style={styles.actionLabel}>派给 Agent</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.action} onPress={() => extras.onBindAgent?.(data)}>
            <Icon name="Link" size={14} color={theme.colors.foreground} />
            <Text style={styles.actionLabel}>绑定 Agent</Text>
          </Pressable>
        </>}
        <Pressable accessibilityRole="button" style={styles.action} onPress={() => extras.onComment?.(data)}>
          <Icon name="MessageSquarePlus" size={14} color={theme.colors.foreground} />
          <Text style={styles.actionLabel}>写回评论</Text>
        </Pressable>
        <StatusDropdown
          key={`${data.workspaceId}-${data.kind}-${data.id}`}
          theme={theme}
          kind={data.kind}
          id={data.id}
          workspaceId={data.workspaceId}
          current={data.status}
          currentLabel={data.statusLabel}
          onTransition={extras.onTransition}
          onDone={() => {
            void detail.refetch();
            extras.onStatusDone?.();
          }}
        />
        <Pressable accessibilityRole="button" style={styles.action} onPress={() => void openExternalUrl(data.url)}>
          <Icon name="ExternalLink" size={14} color={theme.colors.foreground} />
          <Text style={styles.actionLabel}>在 TAPD 打开</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.action} onPress={() => void copyLink(data.url)}>
          <Icon name="Copy" size={14} color={theme.colors.foreground} />
          <Text style={styles.actionLabel}>复制链接</Text>
        </Pressable>
        {kind === "story" && extras.onCreateChild ? (
          <>
            <Pressable accessibilityRole="button" accessibilityLabel="创建该需求下的子需求" style={styles.action} onPress={() => extras.onCreateChild?.(data, "story")}><Text style={styles.actionLabel}>+ 子需求</Text></Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="创建该需求下的任务"
              style={styles.action}
              onPress={() => extras.onCreateChild?.(data, "task")}
            >
              <Icon name="ClipboardList" size={14} color={theme.colors.foreground} />
              <Text style={styles.actionLabel}>+ 任务</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="创建该需求下的缺陷"
              style={styles.action}
              onPress={() => extras.onCreateChild?.(data, "bug")}
            >
              <Icon name="Bug" size={14} color={theme.colors.foreground} />
              <Text style={styles.actionLabel}>+ 缺陷</Text>
            </Pressable>
          </>
        ) : null}
        <Pressable accessibilityRole="button" style={styles.action} onPress={() => void detail.refetch()}>
          <Icon name="RefreshCw" size={14} color={theme.colors.foreground} />
          <Text style={styles.actionLabel}>刷新</Text>
        </Pressable>
        {removeAction}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, padding: 16, backgroundColor: theme.colors.surface1, borderRadius: 10 }}>
      <View style={styles.metaRow}>
        <Text style={styles.metaLabel}>状态</Text>
        <View style={{ flex: 1, alignItems: "flex-start" }}>
          <Chip
            label={data.statusLabel}
            theme={theme}
            tone={tone === "neutral" ? "muted" : "plain"}
            color={toneColor(tone, theme)}
          />
        </View>
      </View>
      {metaRow("处理人", data.owner)}
      {metaRow("创建人", data.creator)}
      {data.priority ? (
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>优先级</Text>
          <Chip label={data.priority} theme={theme} color={toneColor(priorityTone(data.priority), theme)} />
        </View>
      ) : null}
      {metaRow("迭代", data.iterationName)}
      {metaRow("创建", data.createdAt)}
      {metaRow("更新", data.modifiedAt)}
      </View>
      {data.kind === "story" ? <StoryShortFields key={`${data.workspaceId}-${data.id}`} target={{ workspaceId: data.workspaceId, id: data.id }} theme={theme} refreshToken={extras.refreshToken} /> : null}
      {data.labels?.length || data.labels == null ? <View style={{ gap: 6 }}><Text style={styles.section}>标签</Text><EntityLabels labels={data.labels} theme={theme} compact={false} /></View> : null}
      {entityLinks.length > 0 ? (
        <>
          <Text style={styles.section}>关联任务</Text>
          {entityLinks.map((link) => (
            <AgentLinkRow
              key={`${link.workspaceId}-${link.agentId}`}
              link={link}
              data={data}
              theme={theme}
              extras={extras}
              status={agentStatusMap.get(link.agentId)}
            />
          ))}
        </>
      ) : null}
      <Text style={styles.section}>描述</Text>
      <RichText html={data.descriptionHtml} text={data.description} baseUrl={data.url} workspaceId={data.workspaceId} theme={theme} />
      {data.parentStory ? (
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>所属需求</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`打开所属需求 #${data.parentStory.id}`}
            onPress={() => openParentStory(data.parentStory, extras)}
          >
            <Text style={{ ...styles.linkAction, flex: 1 }} numberOfLines={1}>
              #{data.parentStory.id} {data.parentStory.title || "（标题未获取）"}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {data.kind === "story" && (["story", "task", "bug"] as const).map(childKind => {
        const items = childKind === "story" ? data.childStories ?? [] : childKind === "task" ? data.childTasks : data.childBugs;
        const meta = data.childReads?.[childKind];
        if (!items.length && !meta) return null;
        const hint = meta ? `${items.length} 条已读取 / 共 ${meta.total ?? "未知"} 条${meta.truncated ? " · 已截断" : ""}${meta.error ? ` · ${meta.error}` : ""}` : undefined;
        return <ChildListSection key={`${data.id}-${childKind}`} label={childKind === "story" ? "子需求" : childKind === "task" ? "需求下任务" : "需求下缺陷"} items={items} totalHint={hint} theme={theme} extras={extras} />;
      })}
      <Text style={styles.section}>评论（{data.comments.length}）</Text>
      {data.commentsError ? <Text style={styles.error}>评论加载失败：{data.commentsError}</Text> : null}
      {data.comments.length === 0 ? (
        <View style={styles.box}>
          <Text style={styles.description}>（暂无评论）</Text>
        </View>
      ) : (
        data.comments.map((comment) => (
          <View key={comment.id} style={styles.comment}>
            <Text style={styles.commentHead}>
              {comment.author || "未知"} · {formatTime(comment.createdAt)}
            </Text>
            <RichText html={comment.html} text={comment.text} baseUrl={data.url} workspaceId={data.workspaceId} theme={theme} />
          </View>
        ))
      )}
    </View>
  );
}

type EntityChildItem = NonNullable<EntityDetailData["childTasks"]>[number];

/** 打开所属需求：优先在浮窗内切换详情，否则在浏览器打开 */
function openParentStory(
  parent: EntityDetailData["parentStory"],
  extras: DetailExtras,
) {
  if (!parent) return;
  if (extras.onOpenEntity) {
    extras.onOpenEntity({ kind: "story", id: parent.id, title: parent.title || `#${parent.id}` });
    return;
  }
  void openExternalUrl(parent.url);
}

/** 需求详情：该需求下挂的任务/缺陷列表（10 条一页，可翻页） */
function ChildListSection({ label, items, totalHint, theme, extras }: {
  label: string;
  items: readonly EntityChildItem[];
  /** 非 undefined 表示列表被上限截断，如「前 200 / 共 235 条」 */
  totalHint?: string;
  theme: WorkbenchTheme;
  extras: DetailExtras;
}) {
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * PAGE_SIZE;
  const visible = items.slice(start, start + PAGE_SIZE);

  const styles = useMemo<{
    section: TextStyle;
    row: ViewStyle;
    title: TextStyle;
    meta: TextStyle;
    action: TextStyle;
    fullTitle: TextStyle;
    pager: ViewStyle;
    pageText: TextStyle;
    pageBtn: TextStyle;
    pageBtnDisabled: TextStyle;
  }>(() => ({
    section: { color: theme.colors.foregroundMuted, fontSize: 12 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: theme.colors.surface0,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    title: { color: theme.colors.foreground, fontSize: 12, flex: 1, flexShrink: 1 },
    meta: { color: theme.colors.foregroundMuted, fontSize: 11 },
    action: { color: theme.colors.accent, fontSize: 12 },
    fullTitle: { color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 16 },
    pager: { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "flex-end" },
    pageText: { color: theme.colors.foregroundMuted, fontSize: 11 },
    pageBtn: { color: theme.colors.accent, fontSize: 14 },
    pageBtnDisabled: { color: theme.colors.border, fontSize: 14 },
  }), [theme]);

  function openChild(item: EntityChildItem) {
    if (extras.onOpenEntity) {
      extras.onOpenEntity({ kind: item.kind, id: item.id, title: item.title, workspaceId: item.workspaceId || undefined });
      return;
    }
    void openExternalUrl(item.url);
  }

  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.section}>{label}（{totalHint ?? items.length}）</Text>
      {visible.map((item) => (
        <ChildRow key={item.id} item={item} theme={theme} styles={styles} onOpen={() => openChild(item)} />
      ))}
      {pageCount > 1 ? (
        <View style={styles.pager}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="上一页"
            hitSlop={8}
            disabled={safePage <= 1}
            onPress={() => setPage(safePage - 1)}
          >
            <Icon name="ChevronLeft" size={16} color={safePage <= 1 ? theme.colors.border : theme.colors.accent} />
          </Pressable>
          <Text style={styles.pageText}>第 {safePage} / {pageCount} 页</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="下一页"
            hitSlop={8}
            disabled={safePage >= pageCount}
            onPress={() => setPage(safePage + 1)}
          >
            <Icon name="ChevronRight" size={16} color={safePage >= pageCount ? theme.colors.border : theme.colors.accent} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function ChildRow({ item, theme, styles, onOpen }: {
  item: EntityChildItem;
  theme: WorkbenchTheme;
  styles: { row: ViewStyle; title: TextStyle; meta: TextStyle; action: TextStyle; fullTitle: TextStyle };
  onOpen: () => void;
}) {
  // hover 时在行内展开全文（浮窗方案在此环境会被相邻行遮挡，不采用）
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`打开${item.kind === "task" ? "任务" : item.kind === "story" ? "子需求" : "缺陷"} #${item.id}`}
      style={styles.row}
      onHoverIn={() => setOpen(true)}
      onHoverOut={() => setOpen(false)}
      onPress={onOpen}
    >
      <Icon name={item.kind === "task" ? "ListTodo" : "Bug"} size={14} color={theme.colors.accent} />
      <View style={{ flex: 1, flexShrink: 1, minWidth: 0, gap: 2 }}>
        <Text style={styles.title} numberOfLines={1}>
          #{item.id} {item.title}
        </Text>
        {open ? (
          <Text selectable style={styles.fullTitle}>
            #{item.id} {item.title}
          </Text>
        ) : null}
      </View>
      <Text style={styles.meta}>{item.statusLabel}</Text>
      {item.owner ? <Text style={styles.meta}>{item.owner}</Text> : null}
      <Text style={styles.meta}>{item.responsibleAgent ? `负责 Agent · ${item.responsibleAgent.title || item.responsibleAgent.id}` : item.ownershipUnknown ? "Agent 归属待确认" : "未关联 Agent"}</Text>
      <Text style={styles.action}>详情</Text>
    </Pressable>
  );
}

/** 关联 Agent 行：展示 agent 实时状态与最近一次 turn 结果 */
function AgentLinkRow({ link, data, theme, extras, status }: {
  data: EntityDetailData;
  link: TapdLink;
  theme: WorkbenchTheme;
  extras: DetailExtras;
  status?: AgentStatusItem;
}) {
  const [resultOpen, setResultOpen] = useState(false);
  const title = useMemo(() => {
    const base = link.agentTitle || link.workspaceTitle || "";
    return base.length > 40 ? `${base.slice(0, 40)}…` : base;
  }, [link.agentTitle, link.workspaceTitle]);
  const shortId = (link.agentId || link.workspaceId).slice(0, 8);

  const styles = useMemo<{
    row: ViewStyle;
    resultBox: ViewStyle;
    tipText: TextStyle;
    statusText: TextStyle;
    titleText: TextStyle;
    idText: TextStyle;
    actionText: TextStyle;
    dangerText: TextStyle;
  }>(() => ({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: theme.colors.surface0,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    resultBox: {
      backgroundColor: theme.colors.surface2,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 8,
      padding: 10,
      marginTop: 4,
    },
    tipText: { color: theme.colors.foreground, fontSize: 12, lineHeight: 18 },
    statusText: { color: theme.colors.foregroundMuted, fontSize: 11 },
    titleText: { color: theme.colors.foreground, fontSize: 12, flexShrink: 1 },
    idText: { color: theme.colors.foregroundMuted, fontSize: 11 },
    actionText: { color: theme.colors.accent, fontSize: 12 },
    dangerText: { color: theme.colors.statusDanger, fontSize: 12 },
  }), [theme]);

  const liveStatus = status?.status ?? "";
  const statusColor = agentStatusColor(liveStatus, theme);
  const statusLabel =
    liveStatus === "running"
      ? "运行中"
      : liveStatus === "idle"
        ? "空闲"
        : liveStatus === "initializing"
          ? "启动中"
          : liveStatus === "error"
            ? "异常"
            : liveStatus === "closed"
              ? "已关闭"
              : "";
  const hasTurn = Boolean(status?.turnOutcome);
  const turnedAt = formatIsoTime(status?.turnEndedAt ?? "");
  const turnLabel =
    status?.turnOutcome === "completed"
      ? "上轮已结束"
      : status?.turnOutcome === "failed"
        ? "上轮失败"
        : status?.turnOutcome === "canceled"
          ? "上轮取消"
          : "";
  const turnText = (status?.turnError || status?.turnSummary || (hasTurn ? "本轮摘要未提取，请查看 Agent 会话；回合结束不代表业务完成。" : "")).trim();
  const turnColor =
    status?.turnOutcome === "failed"
      ? theme.colors.statusDanger
      : status?.turnOutcome === "canceled"
        ? theme.colors.foregroundMuted
        : theme.colors.statusSuccess;

  return (
    <View>
      <View style={styles.row}>
        <Icon name="Bot" size={14} color={theme.colors.accent} />
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={styles.titleText} numberOfLines={1}>
            {title || `wks ${link.workspaceId}`}
          </Text>
          <Text style={styles.idText}>{shortId}</Text>
        </View>
        {link.agentId && liveStatus ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor }} />
            <Text style={styles.statusText}>
              {statusLabel}
              {status?.updatedAt ? ` · ${formatIsoTime(status.updatedAt)}` : ""}
            </Text>
          </View>
        ) : null}
        {extras.navigation?.openWorkspace ? (
          <Pressable accessibilityRole="button" onPress={() => extras.navigation?.openWorkspace?.({ workspaceId: link.workspaceId })}>
            <Text style={styles.actionText}>打开工作区</Text>
          </Pressable>
        ) : null}
        {link.agentId && extras.navigation?.openAgent ? (
          <Pressable accessibilityRole="button" onPress={() => extras.navigation?.openAgent?.({ agentId: link.agentId })}>
            <Text style={styles.actionText}>打开 Agent</Text>
          </Pressable>
        ) : null}
        {extras.onTransferLink && toolLinkSchema.safeParse(link).data?.responsibility ? <Pressable accessibilityRole="button" accessibilityLabel="转交任务" onPress={() => extras.onTransferLink?.(link, data)}><Text style={styles.actionText}>转交</Text></Pressable> : null}
        {extras.onRemoveLink ? (
          <Pressable accessibilityRole="button" onPress={() => extras.onRemoveLink?.(link)}>
            <Text style={styles.dangerText}>{toolLinkSchema.safeParse(link).data?.responsibility ? "退出" : "解除"}</Text>
          </Pressable>
        ) : null}
      </View>
      {link.agentId && hasTurn ? (
        <View style={{ paddingLeft: 10 }}>
          {hasTurn && turnLabel ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="查看上次结果"
              onPress={() => setResultOpen((value) => !value)}
              style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 2 }}
            >
              <Icon name={resultOpen ? "ChevronDown" : "ChevronRight"} size={11} color={turnColor} />
              <Text style={{ color: turnColor, fontSize: 11, flexShrink: 1 }} numberOfLines={resultOpen ? undefined : 1}>
                {turnLabel}
                {turnedAt ? ` ${turnedAt}` : ""}
                {!resultOpen && turnText ? ` · ${turnText}` : ""}
              </Text>
            </Pressable>
          ) : null}
          {hasTurn && resultOpen && turnText ? (
            <View style={styles.resultBox}>
              <Text style={styles.tipText} selectable>
                {turnText}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
