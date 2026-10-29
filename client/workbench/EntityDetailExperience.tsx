import { DispatchModal } from "./DispatchModal";
import { useSettings, type PluginScreenProps } from "@getpaseo/plugin/client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text } from "react-native";
import { tapdSettings, type EntityKind } from "../../shared/contracts";
import { WorkbenchDialog } from "./WorkbenchDialog";
import { CreateEntityModal, type CreateChildPreset, type CreatedEntity } from "./CreateEntityModal";
import { EntityDetailModal } from "./EntityDetailModal";
import { type DetailExtras, type DetailTarget, type EntityDetailData } from "./EntityDetailContent";
import { CommentModal, StatusTransitionModal, type StatusChangeTarget } from "./EntityWriteBack";
import type { WorkbenchTheme } from "./bits";

export function EntityDetailExperience({ target: detail, onTargetChange: setDetail, theme, navigation, createOpen: controlledCreateOpen, onCreateOpenChange, onChanged, onDismiss }: {
  target: DetailTarget | null;
  onTargetChange: (target: DetailTarget | null) => void;
  theme: WorkbenchTheme;
  navigation?: PluginScreenProps["navigation"];
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
  onChanged?: () => void;
  onDismiss?: () => void;
}) {
  const settings = useSettings(tapdSettings);
  const queryClient = useQueryClient();
  const [localCreateOpen, setLocalCreateOpen] = useState(false);
  const createOpen = controlledCreateOpen ?? localCreateOpen;
  const setCreateOpen = onCreateOpenChange ?? setLocalCreateOpen;
  const [createPreset, setCreatePreset] = useState<CreateChildPreset | null>(null);
  const [dispatchTarget,setDispatchTarget]=useState<EntityDetailData|null>(null);
  const [detailVersion, setDetailVersion] = useState(0);
  const [commentTarget, setCommentTarget] = useState<{ kind: EntityKind; id: string; workspaceId?: string } | null>(null);
  const [transitionTarget, setTransitionTarget] = useState<StatusChangeTarget | null>(null);
  if (settings.status !== "ready") return <WorkbenchDialog onDismiss={onDismiss} title="单据详情" theme={theme} open={!!detail} onOpenChange={() => setDetail(null)}><Text style={{ color: theme.colors.foreground, padding: 24 }}>TAPD 配置暂不可用，请检查插件设置后重试。</Text></WorkbenchDialog>;
  function handleCreated(created: CreatedEntity) {
    if (createPreset) {
      queryClient.invalidateQueries({ queryKey: ["tapd-entity", "story", createPreset.storyId] });
      setCreatePreset(null);
    }
    setCreateOpen(false);
    setDetail({ ...detail, kind: created.kind, id: created.id, title: created.title });
    onChanged?.();
  }

  function handleWriteDone() {
    setDetailVersion((version) => version + 1);
    onChanged?.();
  }

  const detailExtras: DetailExtras = {
    refreshToken: detailVersion,
    onDispatch: setDispatchTarget,
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
  const hidden=createOpen || !!dispatchTarget || !!commentTarget || !!transitionTarget;
  return <>
    <EntityDetailModal onDismiss={() => { if (!detail) onDismiss?.(); }} hidden={hidden} target={detail} onClose={() => setDetail(null)} theme={theme} extras={detailExtras} />
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
      {dispatchTarget ? <DispatchModal open backToDetail={!!detail} onClose={()=>setDispatchTarget(null)} theme={theme} data={dispatchTarget} defaultRepoPath={settings.values.lastRepoPath} defaultProvider={settings.values.lastProvider} onCreated={({agentId})=>{setDispatchTarget(null);navigation?.openAgent?.({agentId});}} /> : null}
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
  </>;
}
