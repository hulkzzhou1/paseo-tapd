// Run the plugin bundle through the compatible main client's actual registration boundary.
const assert=require('node:assert/strict'),{createRequire}=require('node:module'),{mkdtempSync,writeFileSync,readFileSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),path=require('node:path');
async function main(){
 assert(process.env.PASEO_APP_DIR,'Set PASEO_APP_DIR to the compatible main app');
 const app=path.resolve(process.env.PASEO_APP_DIR),root=path.resolve(__dirname,'..'),fromApp=createRequire(path.join(app,'package.json')),temp=mkdtempSync(path.join(tmpdir(),'tapd-client-entry-'));
 try{
  const esbuild=fromApp('esbuild'),bindings=path.join(temp,'bindings.ts');
  // Native UI/hooks need a host tree; registration/validation/cleanup use the unmodified evaluator.
  writeFileSync(bindings,`export const SidebarRow=()=>null,Icon=()=>null,SvgIcon=()=>null,useRevealedText=()=>{},useSettings=()=>{},openExternalUrl=()=>{},parsePluginThemeContribution=x=>x;`);
  const evaluator=(await esbuild.build({entryPoints:[path.join(app,'src/plugins/evaluate.ts')],bundle:true,write:false,format:'cjs',platform:'node',resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.js','.json'],alias:{'react-native':fromApp.resolve('react-native-web'),'react-native-svg':path.join(path.dirname(fromApp.resolve('react-native-svg/package.json')),'lib/module/ReactNativeSVG.web.js')},plugins:[{name:'host-render-bindings',setup(build){build.onResolve({filter:/.*/},args=>{
   if(args.importer===path.join(app,'src/plugins/evaluate.ts')&&['./react-native/ui','./settings/use-settings','./themes','@/hooks/use-revealed-text','@/utils/open-external-url'].includes(args.path)||args.path==='@/components/provider-icons')return{path:bindings};
  });}}],logLevel:'silent'})).outputFiles[0].text;
  const evaluatorFile=path.join(temp,'client-runtime.cjs');writeFileSync(evaluatorFile,evaluator);
  const {runPluginClientBundle}=require(evaluatorFile);
  const client=esbuild.buildSync({entryPoints:[path.join(root,'index.client.tsx')],bundle:true,write:false,format:'cjs',platform:'browser',external:['@getpaseo/plugin','@getpaseo/plugin/*','react','react/*','react-native','@tanstack/react-query','zod'],logLevel:'silent'}).outputFiles[0].text;
  const source=process.env.TAPD_CLIENT_BUNDLE_FILE?readFileSync(process.env.TAPD_CLIENT_BUNDLE_FILE,'utf8'):`(function(require){const module={exports:{}};const exports=module.exports;${client};return module.exports;})`;
  let opened;
  const runtime={paseo:{},hosts:{},rpc:async()=>{},openSettings(){},openScreen:value=>{opened=value;},openSurface(){},openPanel(){},addHeaderButton(){throw Error('Unexpected button');},addComposerPill(){throw Error('Retired composer');}};
  const plugin=runPluginClientBundle('tapd-workbench',source,runtime);
  assert(plugin.surfaces.some(screen=>screen.id==='tapd-board'));
  assert(plugin.sidebarItems.header.some(item=>item.id==='tapd-board'));
  const command=plugin.commandCenterItems.find(item=>item.id==='tapd-open-board');assert(command);
  await command.onSelect({openScreen:runtime.openScreen});assert.equal(opened.screenId,'tapd-board');
  assert.equal(plugin.timelineTransformers.length,0);
  assert.equal(plugin.timelineRenderers.length,0);
  await plugin.cleanup();assert.equal(plugin.surfaces.length,0);assert.equal(plugin.sidebarItems.header.length,0);
  console.log('PASS actual main client: plugin loads, workbench/sidebar/command register, no retired card registrations, cleanup succeeds');
 }finally{rmSync(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
