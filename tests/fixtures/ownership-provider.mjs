// Synthetic provider: creating/restoring sessions is allowed; any execution fails the acceptance run.
import {randomUUID} from 'node:crypto';
export function ownershipProvider(onPrompt) {
 const provider='codex';
 const capabilities={supportsStreaming:true,supportsSessionPersistence:true,supportsDynamicModes:true,supportsMcpServers:true,supportsReasoningStream:false,supportsToolInvocations:false,supportsRewindConversation:false,supportsRewindFiles:false,supportsRewindBoth:false};
 const modes=[{id:'full-access',label:'Fixture',description:'Synthetic fixture'}];
 const session=(config,id=randomUUID())=>({provider,id,capabilities,run:async()=>{onPrompt();throw new Error('Unexpected execution');},startTurn:async()=>{onPrompt();throw new Error('Unexpected execution');},subscribe:()=>()=>{},async *streamHistory(){},getRuntimeInfo:async()=>({provider,sessionId:id,model:config.model??'example-model',modeId:'full-access'}),getAvailableModes:async()=>modes,getCurrentMode:async()=> 'full-access',setMode:async()=>{},getPendingPermissions:()=>[],respondToPermission:async()=>{},describePersistence:()=>({provider,sessionId:id}),interrupt:async()=>{},close:async()=>{}});
 return {provider,capabilities,isAvailable:async()=>true,fetchCatalog:async()=>({models:[{provider,id:'example-model',label:'Fixture',isDefault:true}],modes}),createSession:async config=>session(config),resumeSession:async(handle,overrides={})=>session(overrides,handle.sessionId)};
}
