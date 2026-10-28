import {useState} from "react";
import {Pressable,ScrollView,Text,View} from "react-native";
import {TextInput} from "@getpaseo/plugin/client/react-native";
import type {MigrationGroup} from "../../shared/ownership-migration";
import type {WorkbenchTheme} from "../workbench/bits";
export function MigrationList({groups,warnings,theme,pending,error,onBack,onConfirm}:{groups:readonly MigrationGroup[];warnings:readonly string[];theme:WorkbenchTheme;pending:boolean;error:boolean;onBack:()=>void;onConfirm:(group:MigrationGroup,agentId:string)=>void}){
 const c=theme.colors;const [query,setQuery]=useState("");const [selection,setSelection]=useState<Record<string,string>>({});
 const needle=query.trim().toLocaleLowerCase();const visible=groups.filter(group=>`${group.id} ${group.workspaceId} ${group.candidates.map(link=>`${link.agentTitle} ${link.agentId}`).join(" ")}`.toLocaleLowerCase().includes(needle));
 return <View style={{flex:1,backgroundColor:c.surface0}}>
  <View style={{padding:12,gap:8,borderBottomWidth:1,borderColor:c.border}}>
   <Pressable accessibilityRole="button" onPress={onBack} style={{minHeight:36,justifyContent:"center"}}><Text style={{color:c.accent,fontSize:12}}>返回任务看板</Text></Pressable>
   <Text accessibilityRole="header" style={{color:c.foreground,fontSize:16,fontWeight:"600"}}>历史关联归属确认</Text>
   <Text style={{color:c.foregroundMuted,fontSize:12,lineHeight:18}}>历史查看不会成为任务。请明确选择负责 Agent；确认不会启动执行或修改 TAPD。</Text>
   <TextInput accessibilityLabel="搜索历史关联" placeholder="搜索单号、项目或 Agent" value={query} onChangeText={setQuery} style={{color:c.foreground,minHeight:40,paddingHorizontal:10,borderRadius:8,borderWidth:1,borderColor:c.border}} />
   {!!warnings.length&&<Text accessibilityLiveRegion="polite" style={{color:c.statusWarning,fontSize:12}}>{warnings.join(" ")}</Text>}
   {error&&<Text accessibilityLiveRegion="polite" style={{color:c.statusDanger,fontSize:12}}>确认未成功，请刷新核对候选后重试；原关联已保留。</Text>}
  </View>
  <ScrollView contentContainerStyle={{padding:12,gap:10}}>{visible.map(group=>{
   const key=`${group.workspaceId}/${group.kind}/${group.id}`;
   return <View key={key} style={{padding:10,gap:8,borderWidth:1,borderColor:c.border,borderRadius:8,backgroundColor:c.surface1}}>
    <Text style={{color:c.foreground,fontSize:13,fontWeight:"600"}}>#{group.id} · {group.candidates.length>1?"负责人待确认":"历史绑定待确认"}</Text>
    <Text style={{color:c.foregroundMuted,fontSize:11}}>项目 {group.workspaceId} · {group.kind}</Text>
    {group.candidates.map(link=><Pressable key={link.agentId} accessibilityRole="radio" accessibilityLabel={`选择${link.agentTitle||link.agentId} 负责 #${group.id}`} accessibilityState={{checked:selection[key]===link.agentId}} disabled={pending} onPress={()=>setSelection(current=>({...current,[key]:link.agentId}))} style={({pressed})=>({minHeight:40,padding:8,borderWidth:1,borderColor:selection[key]===link.agentId?c.accent:c.border,borderRadius:6,backgroundColor:pressed?c.surface2:c.surface0})}>
     <Text style={{color:c.foreground,fontSize:12}}>{selection[key]===link.agentId?"● ":"○ "}{link.agentTitle||link.agentId}</Text>
     <Text style={{color:c.foregroundMuted,fontSize:11}}>来源 · {(link.legacyOrigins??["tool"]).map(origin=>origin==="tool"?"工具历史":"旧设置").join(" / ")}</Text>
    </Pressable>)}
    <Pressable accessibilityRole="button" accessibilityLabel={`确认负责人 #${group.id}`} disabled={pending||!selection[key]} onPress={()=>onConfirm(group,selection[key])} style={{minHeight:40,paddingHorizontal:10,alignItems:"center",justifyContent:"center",borderRadius:6,backgroundColor:c.accent,opacity:pending||!selection[key]?0.5:1}}><Text style={{color:c.accentForeground,fontSize:12}}>确认负责人</Text></Pressable>
   </View>;
  })}{!visible.length&&<Text style={{color:c.foregroundMuted,padding:24,textAlign:"center",fontSize:13}}>没有匹配的历史关联</Text>}</ScrollView>
 </View>;
}
