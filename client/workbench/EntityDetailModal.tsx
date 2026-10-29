import { useRef, useId, useEffect } from "react";
import { WorkbenchDialog } from "./WorkbenchDialog";
import { EntityDetailContent, type DetailExtras, type DetailTarget, type DetailReadingPosition } from "./EntityDetailContent";
import type { WorkbenchTheme } from "./bits";

export function EntityDetailModal({ target, onClose, theme, extras, hidden = false, onDismiss }: {
  target: DetailTarget | null;
  onClose: () => void;
  theme: WorkbenchTheme;
  extras: DetailExtras;
  hidden?: boolean;
  onDismiss?: () => void;
}) {
  const openingId=useId();
  const readingPosition = useRef<DetailReadingPosition>({ key: "", offset: 0, openingId });
  const openingCounter=useRef(0);
  const targetKey=`${target?.siteUrl}:${target?.apiEndpoint}:${target?.workspaceId}:${target?.kind}:${target?.id}`;
  useEffect(()=>{
    readingPosition.current={key:"",offset:0,openingId:`${openingId}-${++openingCounter.current}`};
  },[targetKey,openingId]);
  return <WorkbenchDialog onDismiss={onDismiss} theme={theme} size="reading" title={target ? `#${target.id} · 单据详情` : "单据详情"} open={target !== null && !hidden} onOpenChange={next => { if (!next) onClose(); }}>
    <EntityDetailContent readingPosition={readingPosition} target={target} theme={theme} extras={extras} hidden={hidden} />
  </WorkbenchDialog>;
}
