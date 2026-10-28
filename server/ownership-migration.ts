import {createOwnershipLifecycle} from "./ownership-lifecycle";
import {createHash,randomUUID} from "node:crypto";
import type {AgentToolContext} from "@getpaseo/plugin/server";
import type {z} from "zod";
import {ownershipScopeSchema,toolLinkSchema,type ToolLink} from "../shared/agent-links";
import {migrationConfirmRpc,type MigrationGroup} from "../shared/ownership-migration";
import type {TapdSettingsValues} from "../shared/contracts";
import {sameTask,suppressTask,type AgentLinks,type OwnershipState} from "./agent-links";
import {fetchEntitySummary,resolveConfig,protectFieldData} from "./tapd";

const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
function groups(state:OwnershipState,values:TapdSettingsValues):MigrationGroup[]{
 const config=resolveConfig(values),result:MigrationGroup[]=[];
 for(const link of state.links){
  if(link.responsibility||link.apiEndpoint!==config.endpoint||(link.siteUrl&&link.siteUrl!==config.site)||!config.workspaceIds.includes(link.tapdWorkspaceId)||state.suppressed.some(scope=>sameTask(scope,link)))continue;
  let group=result.find(group=>group.kind===link.kind&&group.id===link.id&&group.workspaceId===link.tapdWorkspaceId);
  if(!group){group={kind:link.kind,id:link.id,workspaceId:link.tapdWorkspaceId,revision:"",candidates:[]};result.push(group);}
  const existing=group.candidates.find(item=>item.agentId===link.agentId);
  const origins=link.legacyOrigins??["tool"];
  if(existing)existing.legacyOrigins=[...new Set([...(existing.legacyOrigins??[]),...origins])].sort();
  else group.candidates.push({...link,legacyOrigins:origins});
 }
 for(const group of result){group.candidates.sort((a,b)=>a.agentId.localeCompare(b.agentId));group.revision=digest(group.candidates);}
 return result;
}
export function createOwnershipMigration(getValues:()=>Promise<TapdSettingsValues>,links:AgentLinks){
 let importing:Promise<{warnings:string[]}>|undefined;
 async function importLegacy(){
  if(importing)return importing;
  importing=(async()=>{
   const values=await getValues(),config=resolveConfig(values),snapshot=await links.state();
   const source=values.links.map(link=>({link,key:digest([config.endpoint,config.site,link])})).filter(item=>!snapshot.imports.includes(item.key)&&!snapshot.deletedAgents.includes(item.link.agentId));
   const warnings:string[]=[];
   if(source.length>200)warnings.push("本轮最多核实 200 条旧关联，其余将在后续读取继续处理。");
   const imported:{key:string;link:ToolLink}[]=[];
   for(const item of source.slice(0,200)){
    let found:ToolLink|undefined;
    for(const project of config.workspaceIds){
     try{await fetchEntitySummary(config,item.link.kind,item.link.id,project);found=toolLinkSchema.parse({...item.link,apiEndpoint:config.endpoint,siteUrl:config.site,tapdWorkspaceId:project,legacyOrigins:["settings"]});break;}catch{/* Never infer a project from a failed read. */}
    }
    if(found){try{protectFieldData(config,found);imported.push({key:item.key,link:found});continue;}catch{/* Preserve unsafe sources without publishing or persisting them. */}}warnings.push("旧关联的实际项目暂无法核实，原设置已保留，可稍后重试。");
   }
   if(imported.length)await links.stateTransaction(async state=>{
    let changed=false;const next={...state,links:[...state.links],imports:[...state.imports]};
    for(const item of imported){
     if(next.imports.includes(item.key))continue;
     next.imports.push(item.key);changed=true;
     if(next.deletedAgents.includes(item.link.agentId)||next.suppressed.some(scope=>sameTask(scope,item.link)))continue;
     const existing=next.links.find(link=>sameTask(link,item.link)&&link.agentId===item.link.agentId);
     if(existing){if(!existing.responsibility){const index=next.links.indexOf(existing);next.links[index]={...existing,legacyOrigins:[...new Set([...(existing.legacyOrigins??["tool"]),"settings" as const])].sort()};}}
     else next.links.push(item.link);
    }
    return {state:changed?next:undefined,result:undefined};
   });
   return {warnings:[...new Set(warnings)]};
  })();
  try{return await importing;}finally{importing=undefined;}
 }
 return {importLegacy,
  async pendingAgents(){const values=await getValues(),config=resolveConfig(values),state=await links.state();const result=values.links.filter(link=>!state.deletedAgents.includes(link.agentId)&&!state.imports.includes(digest([config.endpoint,config.site,link]))).map(({agentId,workspaceId})=>({agentId,workspaceId}));protectFieldData(config,result);return result;},
  async list(agentId:string,context:Pick<AgentToolContext,"paseo">){
   await createOwnershipLifecycle(getValues,links).reconcile(context);
   const agent=context.paseo.agents.ref(agentId);await agent.refresh();if(!agent.current())throw new Error("目标 Agent 不可用。");
   const {warnings}=await importLegacy(),values=await getValues();
   const result=groups(await links.state(),values).filter(group=>group.candidates.some(link=>link.agentId===agentId));
   protectFieldData(resolveConfig(values),result);
   return {groups:result,warnings};
  },
  async confirm(raw:z.infer<typeof migrationConfirmRpc.input>,context:Pick<AgentToolContext,"paseo">){
   const input=migrationConfirmRpc.input.parse(raw);await createOwnershipLifecycle(getValues,links).reconcile(context);await importLegacy();
   const values=await getValues(),config=resolveConfig(values);
   if(!config.workspaceIds.includes(input.workspaceId))throw new Error("单据项目未配置。");
   await fetchEntitySummary(config,input.kind,input.id,input.workspaceId);
   const agent=context.paseo.agents.ref(input.agentId);await agent.refresh();if(!agent.current()||agent.archivedAt)throw new Error("目标 Agent 不可用。");
   return links.stateTransaction(async state=>{
    const scope={apiEndpoint:config.endpoint,siteUrl:config.site,tapdWorkspaceId:input.workspaceId,kind:input.kind,id:input.id};
    const formal=state.links.find(link=>sameTask(link,scope)&&link.responsibility);
    if(formal){protectFieldData(config,formal);if(formal.agentId===input.agentId&&state.suppressed.some(item=>sameTask(item,scope)))return {result:{ok:true as const,changed:false,link:formal}};throw new Error("负责人已改变，请刷新后核对。");}
    const group=groups(state,values).find(group=>group.kind===input.kind&&group.id===input.id&&group.workspaceId===input.workspaceId);
    if(!group||group.revision!==input.expectedRevision)throw new Error("历史候选已改变，请刷新后重新选择。");
    const candidate=group.candidates.find(link=>link.agentId===input.agentId);if(!candidate)throw new Error("只能选择已列出的历史候选。");
    await agent.refresh();if(!agent.current()||agent.archivedAt)throw new Error("目标 Agent 不可用。");
    const at=new Date().toISOString(),revision=randomUUID();
    const link={...candidate,siteUrl:config.site,agentTitle:agent.current()?.title??candidate.agentTitle,workspaceId:agent.workspaceId??candidate.workspaceId,responsibility:{confirmedAt:at,actorAgentId:"user",revision}};
    protectFieldData(config,link);
    const next=suppressTask(state,scope,"user");
    const saved={...next,legacyArchive:[...next.legacyArchive,...next.links.filter(item=>sameTask(item,scope)&&!item.responsibility)],links:[...next.links.filter(item=>!sameTask(item,scope)),link],history:[...next.history,{...ownershipScopeSchema.parse(link),action:"migration" as const,actorAgentId:"user",at,reason:"用户确认历史负责人",agentId:link.agentId,revision}]};
    protectFieldData(config,saved);
    return {state:saved,result:{ok:true as const,changed:true,link}};
   });
  },
 };
}
