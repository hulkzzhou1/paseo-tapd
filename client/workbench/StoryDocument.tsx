import {useRpc,useSettings} from '@getpaseo/plugin/client';
import {useQuery} from '@tanstack/react-query';
import {useState} from 'react';
import {ActivityIndicator,Pressable,Text,View} from 'react-native';
import {tapdSettings} from '../../shared/contracts';
import {storyDocumentRpc} from '../../shared/story-fields';
import {RichText} from './RichText';
import type {WorkbenchTheme} from './bits';

/** Each explicit refresh gets a distinct query identity; an older in-flight read cannot replace it. */
export function StoryDocument({openingId,target,fieldKey,revision,refreshToken,baseUrl,theme,onRefresh}:{
  openingId:string;target:{workspaceId:string;id:string};fieldKey:string;revision:number;refreshToken:number;baseUrl:string;theme:WorkbenchTheme;onRefresh:()=>void;
}){
  const rpc=useRpc(storyDocumentRpc),settings=useSettings(tapdSettings),colors=theme.colors;
  const [focused,setFocused]=useState(false);
  const query=useQuery({
    queryKey:['tapd-story-document',openingId,settings.status==='ready'?settings.revision:settings.status,target.workspaceId,target.id,fieldKey,refreshToken,revision],
    queryFn:()=>rpc({...target,fieldKey}),enabled:settings.status==='ready',staleTime:Infinity,gcTime:60_000,retry:false,retryOnMount:false,
  });
  const states={empty:'尚未填写',unknown:'字段值未知（null）',not_returned:'此字段未返回，无法确认内容。',unrecognized:'字段值格式无法识别。'};
  return <View style={{gap:16}}>
    <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12}}>
      <Text style={{fontSize:12,color:colors.foregroundMuted}}>只读文档</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={query.isError?'重试读取文档':'刷新当前文档'} onPress={onRefresh} onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)}
        style={{padding:8,borderRadius:6,borderWidth:1,borderColor:focused?colors.accent:colors.border}}>
        <Text style={{fontSize:12,color:colors.accent}}>{query.isError?'重试':'刷新'}</Text>
      </Pressable>
    </View>
    {query.isPending?<View style={{flexDirection:'row',alignItems:'center',gap:8}}><ActivityIndicator color={colors.accent}/><Text accessibilityLiveRegion="polite" style={{color:colors.foregroundMuted}}>正在读取文档…</Text></View>:null}
    {query.isError?<Text accessibilityRole="alert" style={{color:colors.statusWarning}}>文档读取失败，请重试；其他页仍可阅读。</Text>:null}
    {query.data?.state==='value'?<RichText html={query.data.value??''} text={query.data.value??''} baseUrl={baseUrl} workspaceId={target.workspaceId} theme={theme}/>:null}
    {query.data&&query.data.state!=='value'?<Text accessibilityLiveRegion="polite" style={{fontSize:14,lineHeight:24,color:colors.foregroundMuted}}>{states[query.data.state]}</Text>:null}
  </View>;
}
