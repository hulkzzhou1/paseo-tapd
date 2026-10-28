import {createHash} from "node:crypto";
import type {TaskBoardItem} from "../shared/task-board";
import type {TapdConfig} from "./tapd";

const revisions=new Map<string,number>();
const snapshots=new Map<string,Pick<TaskBoardItem,"entity"|"fetchedAt">>();
function connection(config:TapdConfig){return JSON.stringify([process.env.PASEO_HOME??"",config.endpoint,config.site,createHash("sha256").update(config.token).digest("hex")]);}
export function taskBoardRevision(config:TapdConfig){return revisions.get(connection(config))??0;}
export function invalidateTaskBoards(config:TapdConfig){const key=connection(config);revisions.set(key,(revisions.get(key)??0)+1);}
export function boardSnapshotKey(config:TapdConfig,project:string,kind:string,id:string){return JSON.stringify([connection(config),project,kind,id]);}
export function getBoardSnapshot(key:string){return snapshots.get(key);}
export function saveBoardSnapshot(key:string,item:TaskBoardItem){snapshots.delete(key);snapshots.set(key,{entity:item.entity,fetchedAt:item.fetchedAt});if(snapshots.size>500)snapshots.delete(snapshots.keys().next().value!);}

export function deleteBoardSnapshot(key:string){snapshots.delete(key);}
