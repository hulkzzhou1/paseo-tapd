import { useSettings, type PluginScreenProps } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { tapdSettings, type EntityKind, type TapdLink } from "../../shared/contracts";
import { WorkbenchDialog } from "./WorkbenchDialog";
import { Text } from "react-native";
import { BindAgentModal } from "./BindAgentModal";
import { CreateEntityModal, type CreateChildPreset, type CreatedEntity } from "./CreateEntityModal";
import { DispatchModal } from "./DispatchModal";
import { EntityDetailModal } from "./EntityDetailModal";
import { EntityDetailContent, type DetailExtras, type DetailTarget, type EntityDetailData } from "./EntityDetailContent";
import { CommentModal } from "./EntityWriteBack";
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
  const queryClient = useQueryClient();
  const toast = useToast();
  const [localCreateOpen, setLocalCreateOpen] = useState(false);
  const createOpen = controlledCreateOpen ?? localCreateOpen;
  const setCreateOpen = onCreateOpenChange ?? setLocalCreateOpen;
  const [createPreset, setCreatePreset] = useState<CreateChildPreset | null>(null);
  const [detailVersion, setDetailVersion] = useState(0);
  const [dispatchTarget, setDispatchTarget] = useState<EntityDetailData | null>(null);
  const [commentTarget, setCommentTarget] = useState<{ kind: EntityKind; id: string; workspaceId?: string } | null>(null);
  const [bindTarget, setBindTarget] = useState<EntityDetailData | null>(null);
  if (settings.status !== "ready" && presentation === "panel") return <Text style={{ color: theme.colors.foreground, padding: 24 }}>TAPD 配置暂不可用，请检查插件设置后重试。</Text>;
  if (settings.status !== "ready") return <WorkbenchDialog onDismiss={onDismiss} title="单据详情" theme={theme} open={!!detail} onOpenChange={() => setDetail(null)}><Text style={{ color: theme.colors.foreground, padding: 24 }}>TAPD 配置暂不可用，请检查插件设置后重试。</Text></WorkbenchDialog>;
  const readySettings = settings;
  const links = readySettings.values.links;
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
        links: [...values.links, input.link],
        lastRepoPath: input.repoPath ?? values.lastRepoPath,
        lastProvider: input.provider ?? values.lastProvider,
      },
      readySettings.revision,
    );
    if (!ok) toast.error(readySettings.saveError ?? "保存关联失败，请重试");
    setDispatchTarget(null);
  }

  async function handleRemoveLink(link: TapdLink) {
    const values = readySettings.values;
    const next = values.links.filter(
      (item) => !(item.key === link.key && item.workspaceId === link.workspaceId),
    );
    const ok = await readySettings.save({ ...values, links: next }, readySettings.revision);
    if (!ok) toast.error(readySettings.saveError ?? "保存失败，请重试");
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
    onBindAgent: (data) => setBindTarget(data),
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
    onOpenEntity: (target) => setDetail({ ...detail, ...target }),
  };
  return <>
      {presentation === "panel" ? <EntityDetailContent target={detail} theme={theme} extras={detailExtras} hidden={createOpen || !!dispatchTarget || !!commentTarget || !!bindTarget} /> : <EntityDetailModal onDismiss={() => { if (!detail) onDismiss?.(); }} hidden={createOpen || !!dispatchTarget || !!commentTarget || !!bindTarget} target={detail} onClose={() => setDetail(null)} theme={theme} extras={detailExtras} />}
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
      {bindTarget ? (
        <BindAgentModal
          backToDetail={!!detail}
          open
          onClose={() => setBindTarget(null)}
          theme={theme}
          data={bindTarget}
          links={links}
          onBound={(link) => void handleLinkCreated({ link })}
        />
      ) : null}
  </>;
}
