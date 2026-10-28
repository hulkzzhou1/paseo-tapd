import type {EntityKind} from "../../shared/contracts";
type Target={kind:EntityKind;id:string;workspaceId?:string};
const listeners=new Set<(target:Target)=>void>();
export function invalidateBoard(target:Target){for(const listener of listeners)listener(target);}
export function subscribeBoardUpdates(listener:(target:Target)=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
