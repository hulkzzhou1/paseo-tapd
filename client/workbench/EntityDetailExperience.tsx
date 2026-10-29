import { useAgentLinks } from "./useAgentLinks";
import { removeAgentLinkRpc, toolLinkSchema, type ToolLink } from "../../shared/agent-links";
import { useRpc, useSettings, type PluginScreenProps } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { tapdSettings, type EntityKind, type TapdLink } from "../../shared/contracts";
import { taskReleaseRpc } from "../../shared/task-board";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import { WorkbenchDialog, dialogFormStyles } from "./WorkbenchDialog";
import { Text, Pressable } from "react-native";
import { BindAgentModal } from "./BindAgentModal";
import { CreateEntityModal, type CreateChildPreset, type CreatedEntity } from "./CreateEntityModal";
import { DispatchModal } from "./DispatchModal";
import { EntityDetailModal } from "./EntityDetailModal";
import { EntityDetailContent, type DetailExtras, type DetailTarget, type EntityDetailData } from "./EntityDetailContent";
import { CommentModal, StatusTransitionModal, type StatusChangeTarget } from "./EntityWriteBack";
import type { WorkbenchTheme } from "./bits";

export function EntityDetailExperience({ target: detail, onTargetChange: setDetail, theme, navigation, createOpen: controlledCreateOpen, onCreateOpenChange, onChanged, onDismiss, onRemoveFromConversation, presentation = "dialog" }: {
  presentation?: "dialog" | "panel";
  target: DetailTarget | null;
  onTargetChange: (target: DetailTarget | null) => void;
  theme: WorkbenchTheme;
  navigation?: PluginScreenProps["navigation"];
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
  onChanged?: () => void;
  onDismiss?: () => void;
  onRemoveFromConversation?: () => void;
}) {
  const settings = useSettings(tapdSettings);
  const links = useAgentLinks(settings.status === "ready" ? settings.values.links : [], !!detail);
  const removeToolLink = useRpc(removeAgentLinkRpc);
  const releaseTask = useRpc(taskReleaseRpc);
  const [releaseLink, setReleaseLink] = useState<ToolLink | null>(null);
  const [releaseReason, setReleaseReason] = useState("");
  const [releasing, setReleasing] = useState(false);
  const [transferFrom, setTransferFrom] = useState<ToolLink | undefined>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [localCreateOpen, setLocalCreateOpen] = useState(false);
  const createOpen = controlledCreateOpen ?? localCreateOpen;
  const setCreateOpen = onCreateOpenChange ?? setLocalCreateOpen;
  const [createPreset, setCreatePreset] = useState<CreateChildPreset | null>(null);
  const [detailVersion, setDetailVersion] = useState(0);
  const [dispatchTarget, setDispatchTarget] = useState<EntityDetailData | null>(null);
  const [commentTarget, setCommentTarget] = useState<{ kind: EntityKind; id: string; workspaceId?: string } | null>(null);
  const [transitionTarget, setTransitionTarget] = useState<StatusChangeTarget | null>(null);
  const [bindTarget, setBindTarget] = useState<EntityDetailData | null>(null);
  if (settings.status !== "ready" && presentation === "panel") return <Text style={{ color: theme.colors.foreground, padding: 24 }}>TAPD 配置暂不可用，请检查插件设置后重试。</Text>;
  if (settings.status !== "ready") return <WorkbenchDialog onDismiss={onDismiss} title="单据详情" theme={theme} open={!!detail} onOpenChange={() => setDetail(null)}><Text style={{ color: theme.colors.foreground, padding: 24 }}>TAPD 配置暂不可用，请检查插件设置后重试。</Text></WorkbenchDialog>;
  const readySettings = settings;
  function handleCreated(created: CreatedEntity) {
    if (createPreset) {
      queryClient.invalidateQueries({ queryKey: ["tapd-entity", "story", createPreset.storyId] });
      setCreatePreset(null);
    }
    setCreateOpen(false);
    setDetail({ ...detail, kind: created.kind, id: created.id, title: created.title });
    onChanged?.();
  }

  async function handleLinkCreated(input: { link: TapdLink; repoPath?: string; provider?: string }) {
    const values = readySettings.values;
    const ok = await readySettings.save(
      {
        ...values,
        links: toolLinkSchema.safeParse(input.link).success ? values.links : [...values.links, input.link],
        lastRepoPath: input.repoPath ?? values.lastRepoPath,
        lastProvider: input.provider ?? values.lastProvider,
      },
      readySettings.revision,
    );
    if (!ok) toast.error(readySettings.saveError ?? "保存关联失败，请重试");
    await queryClient.invalidateQueries({ queryKey: ["tapd-agent-links"] });
    setDispatchTarget(null);
  }

  async function handleRemoveLink(link: TapdLink) {
    const toolLink = toolLinkSchema.safeParse(link);
    if (toolLink.success && toolLink.data.responsibility) { setReleaseLink(toolLink.data); setReleaseReason(""); return; }
    if (toolLink.success) {
      try { await removeToolLink(toolLink.data); await queryClient.invalidateQueries({ queryKey: ["tapd-agent-links"] }); }
      catch { toast.error("移除关联失败，请重试"); return; }
    }
    const values = readySettings.values;
    const next = values.links.filter(
      (item) => !(item.key === link.key && item.agentId === link.agentId && item.workspaceId === link.workspaceId),
    );
    const ok = await readySettings.save({ ...values, links: next }, readySettings.revision);
    if (!ok) toast.error(readySettings.saveError ?? "保存失败，请重试");
  }

  async function confirmRelease() {
    if (!releaseLink?.responsibility || !releaseReason.trim() || releasing) return;
    setReleasing(true);
    try {
      await releaseTask({ kind: releaseLink.kind, id: releaseLink.id, workspaceId: releaseLink.tapdWorkspaceId, agentId: releaseLink.agentId, expectedRevision: releaseLink.responsibility.revision, reason: releaseReason.trim(), confirmed: true });
      await queryClient.invalidateQueries({ queryKey: ["tapd-agent-links"] });
      setReleaseLink(null);
    } catch { toast.error("退出未确认成功：承担关系可能已变化，请刷新核查。"); }
    finally { setReleasing(false); }
  }

  function handleWriteDone() {
    setDetailVersion((version) => version + 1);
    onChanged?.();
  }

  const detailExtras: DetailExtras = {
    onRemoveFromConversation,
    links,
    navigation,
    refreshToken: detailVersion,
    onLinkCreated: (input) => void handleLinkCreated(input),
    onRemoveLink: (link) => void handleRemoveLink(link),
    onDispatch: (data) => setDispatchTarget(data),
    onBindAgent: (data) => { setTransferFrom(undefined); setBindTarget(data); },
    onTransferLink: (link, data) => { const parsed = toolLinkSchema.safeParse(link); if (parsed.success && parsed.data.responsibility) { setTransferFrom(parsed.data); setBindTarget(data); } },
    onComment: (data) => setCommentTarget({ kind: data.kind, id: data.id, workspaceId: data.workspaceId }),
    onCreateChild: (data, childKind) => {
      setCreatePreset({
        kind: childKind,
        storyId: data.id,
        workspaceId: data.workspaceId ?? "",
        storyTitle: data.title,
        storyUrl: data.url,
      });
      setCreateOpen(true);
    },
    onStatusDone: () => onChanged?.(),
    onTransition: setTransitionTarget,
    onOpenEntity: (target) => setDetail({ ...detail, ...target }),
  };
  const readingKey=`${detail?.siteUrl}:${detail?.apiEndpoint}:${detail?.workspaceId}:${detail?.kind}:${detail?.id}`;
  return <>
      {presentation === "panel" ? <EntityDetailContent key={readingKey} target={detail} theme={theme} extras={detailExtras} hidden={createOpen || !!dispatchTarget || !!commentTarget || !!bindTarget || !!transitionTarget} /> : <EntityDetailModal onDismiss={() => { if (!detail) onDismiss?.(); }} hidden={createOpen || !!dispatchTarget || !!commentTarget || !!bindTarget || !!transitionTarget} target={detail} onClose={() => setDetail(null)} theme={theme} extras={detailExtras} />}
        <CreateEntityModal
          backToDetail={!!detail}
          open={createOpen}
          initial={createPreset}
          onClose={() => {
            setCreateOpen(false);
            setCreatePreset(null);
          }}
          theme={theme}
          onCreated={handleCreated}
        />
      {dispatchTarget ? (
        <DispatchModal
          backToDetail={!!detail}
          open
          onClose={() => setDispatchTarget(null)}
          theme={theme}
          data={dispatchTarget}
          defaultRepoPath={readySettings.values.lastRepoPath}
          defaultProvider={readySettings.values.lastProvider}
          onCreated={(input) => void handleLinkCreated(input)}
        />
      ) : null}
      {commentTarget ? (
        <CommentModal
          backToDetail={!!detail}
          open
          onClose={() => setCommentTarget(null)}
          theme={theme}
          kind={commentTarget.kind}
          id={commentTarget.id}
          workspaceId={commentTarget.workspaceId}
          onDone={handleWriteDone}
        />
      ) : null}
      {transitionTarget ? <StatusTransitionModal target={transitionTarget} theme={theme} onClose={() => setTransitionTarget(null)} onDone={handleWriteDone} /> : null}
      {releaseLink ? <WorkbenchDialog open title={`退出任务 · #${releaseLink.id}`} theme={theme} pending={releasing} dirty={!!releaseReason} onOpenChange={open => { if (!open) setReleaseLink(null); }}>
        <WorkbenchDialog.Content>
          <Text style={{ color: theme.colors.foreground }}>确认让「{releaseLink.agentTitle || releaseLink.agentId}」退出这张任务？只释放本机承担关系，TAPD 保持原样。</Text>
          <TextInput accessibilityLabel="退出原因" style={dialogFormStyles(theme).input} placeholder="简短说明退出原因（不填写正文或凭据）" maxLength={500} value={releaseReason} onChangeText={setReleaseReason} />
          <Pressable accessibilityRole="button" accessibilityLabel="确认退出" disabled={!releaseReason.trim() || releasing} style={dialogFormStyles(theme).primaryButton} onPress={() => void confirmRelease()}><Text style={dialogFormStyles(theme).primaryLabel}>确认退出</Text></Pressable>
        </WorkbenchDialog.Content>
      </WorkbenchDialog> : null}
      {bindTarget ? (
        <BindAgentModal
          backToDetail={!!detail}
          open
          onClose={() => setBindTarget(null)}
          theme={theme}
          data={bindTarget}
          transferFrom={transferFrom}
          links={links}
          onBound={(link) => void handleLinkCreated({ link })}
        />
      ) : null}
  </>;
}
