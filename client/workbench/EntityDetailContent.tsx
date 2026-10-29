import { StoryShortFields, useStoryFields } from "./StoryShortFields";
import { StoryDocument } from "./StoryDocument";
import { toolLinkSchema } from "../../shared/agent-links";
import { EntityLabels } from "./EntityLabels";
import { RichText } from "./RichText";
import type { RpcOutput } from "@getpaseo/plugin";
import { openExternalUrl, usePaseo, useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, useId, type RefObject } from "react";
import { ActivityIndicator, Pressable, Platform, ScrollView, Text, View, useWindowDimensions, type TextStyle, type ViewStyle } from "react-native";
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

export interface DetailReadingPosition {
  key: string;
  openingId: string;
  offset: number;
  tab?: string;
  offsets?: Record<string, number>;
  documentRevisions?: Record<string, number>;
}

export function EntityDetailContent({ target, theme, extras, hidden = false, readingPosition }: {
  target: DetailTarget | null;
  theme: WorkbenchTheme;
  extras: DetailExtras;
  hidden?: boolean;
  readingPosition?: RefObject<DetailReadingPosition>;
}) {
  const openingId=useId();
  const localPosition = useRef<DetailReadingPosition>({key:"",offset:0,openingId});
  const [panelWidth,setPanelWidth]=useState<number>();
  const key = `${target?.siteUrl}:${target?.apiEndpoint}:${target?.workspaceId}:${target?.kind}:${target?.id}`;
  return <View onLayout={event=>setPanelWidth(event.nativeEvent.layout.width)} style={{flexGrow:1,flexShrink:1,minHeight:0,backgroundColor:theme.colors.surface0,display:hidden?'none':'flex'}}>
    {target?<DetailBody key={key} target={target} theme={theme} extras={extras} panelWidth={panelWidth} hidden={hidden} readingPosition={readingPosition??localPosition} readingKey={key}/>:null}
  </View>;
}

function DetailBody({ target, theme, extras, panelWidth, hidden, readingPosition, readingKey }: { target: DetailTarget; theme: WorkbenchTheme; extras: DetailExtras; panelWidth?: number; hidden:boolean; readingPosition:RefObject<DetailReadingPosition>; readingKey:string }) {
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

  const fields = useStoryFields({workspaceId:detail.data?.kind==='story'?detail.data.workspaceId:'',id:kind==='story'?id:''},extras.refreshToken);
  const richFields = fields.data?.fields.filter(field=>field.kind==='richtext')??[];
  const sameReading = readingPosition.current.key===readingKey;
  const [selectedTab,setSelectedTab]=useState(sameReading?readingPosition.current.tab??'details':'details');
  const [documentRevisions,setDocumentRevisions]=useState<Record<string,number>>(sameReading?readingPosition.current.documentRevisions??{}:{});
  const offsets=useRef<Record<string,number>>(sameReading?readingPosition.current.offsets??{details:readingPosition.current.offset}:{});
  const scroll=useRef<ScrollView>(null),restoring=useRef(true),tabs=useRef(new Map<string,View>());
  const [focusedTab,setFocusedTab]=useState('');
  const activeTab=selectedTab==='details'||richFields.some(field=>field.key===selectedTab)?selectedTab:'details';
  const restoreScroll=useCallback(()=>{
    restoring.current=true;
    scroll.current?.scrollTo({y:offsets.current[activeTab]??0,animated:false});
    requestAnimationFrame(()=>{restoring.current=false;});
  },[activeTab]);
  useEffect(()=>{restoring.current=true;if(!hidden)restoreScroll();},[restoreScroll,hidden]);
  function selectTab(tab:string){
    restoring.current=true;
    readingPosition.current={openingId:readingPosition.current.openingId,key:readingKey,offset:offsets.current.details??0,tab,offsets:offsets.current,documentRevisions};
    setSelectedTab(tab);
  }
  function refreshDocument(){
    const next={...documentRevisions,[activeTab]:(documentRevisions[activeTab]??0)+1};
    readingPosition.current={openingId:readingPosition.current.openingId,key:readingKey,offset:offsets.current.details??0,tab:activeTab,offsets:offsets.current,documentRevisions:next};
    setDocumentRevisions(next);
  }

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
    title: { color: theme.colors.foreground, fontSize: width<500?18:21, lineHeight: width<500?26:30, fontWeight: "600" },
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
    <View style={{flexGrow:1,flexShrink:1,minHeight:0}}>
      <View testID="detail-fixed-header" style={{paddingHorizontal:width<500?16:24,paddingTop:16,paddingBottom:12,gap:10,borderBottomWidth:1,borderColor:theme.colors.border}}>
      <View style={{flexDirection:'row',alignItems:'flex-start',gap:12}}>
        <Text accessibilityRole="header" accessibilityLabel={data.title} numberOfLines={2} style={[styles.title,{flex:1}]}>{data.title}</Text>
        <Chip label={data.statusLabel} theme={theme} tone={tone==='neutral'?'muted':'plain'} color={toneColor(tone,theme)}/>
      </View>
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
        <Pressable accessibilityRole="button" style={styles.action} onPress={() => { void detail.refetch(); if(activeTab!=="details")refreshDocument();else if(kind==="story")void fields.refetch(); }}>
          <Icon name="RefreshCw" size={14} color={theme.colors.foreground} />
          <Text style={styles.actionLabel}>刷新</Text>
        </Pressable>
        {removeAction}
      </View>
      {entityLinks.length?<View style={{flexDirection:'row',alignItems:'center',gap:8}}>
        <Text style={{fontSize:12,color:theme.colors.foregroundMuted}}>关联 Agent</Text>
        <Text numberOfLines={1} style={{flex:1,fontSize:12,color:theme.colors.foreground}}>{entityLinks.map(link=>link.agentTitle||link.workspaceTitle||link.agentId).join('、')}</Text>
      </View>:null}
      </View>
      {kind==='story'?<ScrollView horizontal showsHorizontalScrollIndicator style={{flexGrow:0,flexShrink:0,borderBottomWidth:1,borderColor:theme.colors.border}} contentContainerStyle={{paddingHorizontal:width<500?12:20}}>
        <View accessibilityRole="tablist" accessibilityLabel="需求内容" style={{flexDirection:'row'}}>
          {[{key:'details',label:'详细信息'},...richFields].map((tab,index,list)=><Pressable key={tab.key} ref={element=>{if(element)tabs.current.set(tab.key,element);else tabs.current.delete(tab.key);}}
            nativeID={`${readingPosition.current.openingId}-${tab.key}`} aria-controls={`${readingPosition.current.openingId}-content`} accessibilityRole="tab" aria-selected={activeTab===tab.key} accessibilityState={{selected:activeTab===tab.key}} accessibilityLabel={tab.label||tab.key}
            {...(Platform.OS==='web'?{tabIndex:activeTab===tab.key?0:-1,onKeyDown:(event:{key:string;preventDefault():void})=>{
              const next=event.key==='ArrowRight'?(index+1)%list.length:event.key==='ArrowLeft'?(index+list.length-1)%list.length:event.key==='Home'?0:event.key==='End'?list.length-1:null;
              if(next!==null){event.preventDefault();selectTab(list[next].key);tabs.current.get(list[next].key)?.focus();}
            }}:{})}
            onFocus={()=>setFocusedTab(tab.key)} onBlur={()=>setFocusedTab('')} onPress={()=>selectTab(tab.key)}
            style={{paddingHorizontal:12,paddingVertical:12,borderBottomWidth:2,borderBottomColor:activeTab===tab.key?theme.colors.accent:'transparent',backgroundColor:focusedTab===tab.key?theme.colors.surface2:'transparent'}}>
            <Text style={{fontSize:13,fontWeight:activeTab===tab.key?'600':'400',color:activeTab===tab.key?theme.colors.accent:theme.colors.foregroundMuted}}>{tab.label||tab.key}</Text>
          </Pressable>)}
        </View>
      </ScrollView>:null}
      <ScrollView testID="detail-reading-scroll" nativeID={`${readingPosition.current.openingId}-content`} {...(kind==="story"?{role:"tabpanel" as const,"aria-labelledby":`${readingPosition.current.openingId}-${activeTab}`}:{})} ref={scroll} style={{flexGrow:1,flexShrink:1,minHeight:0}} contentContainerStyle={{padding:width<500?16:24}} scrollEventThrottle={16}
        onContentSizeChange={restoreScroll} onScroll={event=>{
          if(hidden||restoring.current)return;
          offsets.current[activeTab]=event.nativeEvent.contentOffset.y;
          readingPosition.current={openingId:readingPosition.current.openingId,key:readingKey,offset:offsets.current.details??0,tab:activeTab,offsets:offsets.current,documentRevisions};
        }}>
      {activeTab!=='details'?<StoryDocument key={activeTab} openingId={readingPosition.current.openingId} target={{workspaceId:data.workspaceId,id:data.id}} fieldKey={activeTab} revision={documentRevisions[activeTab]??0} refreshToken={extras.refreshToken} baseUrl={data.url} theme={theme} onRefresh={refreshDocument}/>:null}
      <View style={{gap:18,display:activeTab==='details'?'flex':'none'}}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, padding: 16, backgroundColor: theme.colors.surface1, borderRadius: 10 }}>
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
      {data.kind === "story" ? <StoryShortFields key={`${data.workspaceId}-${data.id}`} query={fields} theme={theme} /> : null}
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
      </ScrollView>
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
