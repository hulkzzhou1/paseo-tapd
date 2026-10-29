import {useRpc,useSettings} from '@getpaseo/plugin/client';
import {useQuery} from '@tanstack/react-query';
import {useState} from 'react';
import {ActivityIndicator,Pressable,Text,View} from 'react-native';
import {tapdSettings} from '../../shared/contracts';
import {storyFieldsRpc,type StoryReadingField} from '../../shared/story-fields';
import type {WorkbenchTheme} from './bits';

export function useStoryFields(target:{workspaceId:string;id:string},refreshToken=0){
  const rpc=useRpc(storyFieldsRpc),settings=useSettings(tapdSettings);
  return useQuery({
    queryKey:['tapd-story-fields',settings.status==='ready'?settings.revision:settings.status,target.workspaceId,target.id,refreshToken],
    queryFn:()=>rpc(target),enabled:settings.status==='ready'&&!!target.workspaceId&&!!target.id,
    staleTime:0,gcTime:60_000,retry:false,
  });
}

export function StoryShortFields({target,theme,refreshToken=0}:{target:{workspaceId:string;id:string};theme:WorkbenchTheme;refreshToken?:number}){
  const query=useStoryFields(target,refreshToken),[expanded,setExpanded]=useState(false),[showEmpty,setShowEmpty]=useState(false),colors=theme.colors;
  const fields=query.data?.fields.filter(field=>field.kind!=='richtext')??[];
  const filled=fields.filter(field=>field.state==='value'),empty=fields.filter(field=>field.state==='empty'),uncertain=fields.filter(field=>!['value','empty'].includes(field.state));
  const visible=expanded?fields.filter(field=>field.state!=='empty'||showEmpty):filled.slice(0,6);
  const action=(label:string,onPress:()=>void)=><Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    style={{paddingVertical:7,paddingHorizontal:10,borderWidth:1,borderColor:colors.border,borderRadius:6}}>
    <Text style={{fontSize:12,color:colors.accent}}>{label}</Text>
  </Pressable>;
  return <View testID="story-short-fields" style={{gap:10}}>
    <View style={{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:8}}>
      <Text accessibilityRole="header" style={{fontSize:15,fontWeight:'600',color:colors.foreground,flexGrow:1}}>自定义属性</Text>
      {query.data&&!query.isError?action('刷新自定义字段',()=>{void query.refetch();}):null}
    </View>
    {query.isPending?<View style={{flexDirection:'row',gap:8}}><ActivityIndicator color={colors.accent}/><Text style={{color:colors.foregroundMuted}}>正在读取自定义字段…</Text></View>:null}
    {query.isError?<View style={{gap:8}}><Text accessibilityRole="alert" style={{color:colors.statusWarning}}>读取自定义字段失败，请重试。</Text>{action('重试自定义字段',()=>{void query.refetch();})}</View>:null}
    {!query.isError&&query.data?<>
      {query.data.readError?<View style={{gap:8}}><Text accessibilityRole="alert" style={{color:colors.statusWarning}}>{query.data.readError}</Text>{action('重试自定义字段',()=>{void query.refetch();})}</View>:null}
      {fields.length===0?<Text style={{fontSize:13,color:colors.foregroundMuted}}>没有可展示的短字段。</Text>:null}
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:10}}>
        {visible.map(field=><FieldRow key={field.key} field={field} theme={theme}/>)}
      </View>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
        {filled.length>6||empty.length>0||uncertain.length>0?action(expanded?'收起属性':filled.length>6?`更多属性（${filled.length-6}）`:'查看全部属性',()=>setExpanded(value=>!value)):null}
        {expanded&&empty.length?action(showEmpty?'隐藏空字段':`显示空字段（${empty.length}）`,()=>setShowEmpty(value=>!value)):null}
        {uncertain.length&&!expanded?<Text style={{fontSize:12,color:colors.foregroundMuted,alignSelf:'center'}}>{uncertain.length} 项状态待确认</Text>:null}
      </View>
    </>:null}
  </View>;
}

function FieldRow({field,theme}:{field:StoryReadingField;theme:WorkbenchTheme}){
  const states:Record<StoryReadingField['state'],string>={value:'',empty:'未填写',unknown:'未知（null）',not_returned:'未返回',unrecognized:'无法识别',failed:'读取失败',unread:'尚未读取'};
  return <View style={{minWidth:180,flexBasis:'46%',flexGrow:1,gap:5,padding:12,borderRadius:8,backgroundColor:theme.colors.surface1}}>
    <Text style={{fontSize:12,color:theme.colors.foregroundMuted}}>{field.label||field.key}</Text>
    <Text selectable style={{fontSize:13,lineHeight:20,color:field.state==='value'?theme.colors.foreground:theme.colors.foregroundMuted}}>{field.display??states[field.state]}</Text>
    {field.warning?<Text style={{fontSize:11,lineHeight:16,color:theme.colors.statusWarning}}>{field.warning}</Text>:null}
  </View>;
}
