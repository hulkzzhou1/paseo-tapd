import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fetchContentImage, clearTapdCache } from "../server/tapd.ts";
import { tapdImagePath } from "../shared/rich-text.ts";
const config={endpoint:"https://api.example.com",site:"https://example.com",token:"<token>",tokenSource:"settings",workspaceIds:["12345678","87654321"]};
const imagePath="/tfl/captures/example.png";
const image=readFileSync(new URL('../assets/icon.png',import.meta.url));
const download="https://files.example.com/once.png";
const failure="图片读取失败，请重试或在 TAPD 查看原图。";

test("protected image reads once, uses its actual project, and keeps credentials at API",async t=>{
  clearTapdCache();let apiReads=0,downloads=0;
  t.mock.method(globalThis,"fetch",async(input,init)=>{
    const url=new URL(input);
    if(url.origin===config.endpoint){
      apiReads++;assert.equal(url.pathname,"/files/get_image");assert.equal(url.searchParams.get("workspace_id"),"87654321");assert.equal(url.searchParams.get("image_path"),imagePath);
      assert.equal(init.headers.Authorization,"Bearer <token>");return Response.json({status:1,data:{Attachment:{workspace_id:"87654321",download_url:download}}});
    }
    assert.equal(url.href,download);assert.equal(init.headers,undefined);assert.equal(init.redirect,"manual");downloads++;
    return downloads%2===1?new Response(image,{headers:{"content-type":"image"}}):new Response('<html>used link</html>');
  });
  assert.equal((await fetchContentImage(config,"87654321",imagePath)).dataUri,'data:image/png;base64,'+image.toString('base64'));
  assert.equal(downloads,1);assert.equal(apiReads,1);
  // Retry must obtain a fresh link instead of caching a consumed URL.
  downloads=0;await fetchContentImage(config,"87654321",imagePath);assert.equal(apiReads,2);assert.equal(downloads,1);
});

test("image sources must be site-local TAPD paths and configured projects",async t=>{
  let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;throw new Error('must not fetch');});
  for(const [workspace,path] of [["unconfigured",imagePath],["12345678","https://other.example.com/image.png"],["12345678","/tfl/captures/../../image.png"],["12345678","/tfl/captures/example.svg"],["12345678",imagePath+'?secret=value']]) await assert.rejects(fetchContentImage(config,workspace,path),{message:failure});
  assert.equal(calls,0);
  assert.equal(tapdImagePath(config.site+imagePath,config.site+'/project/item'),imagePath);
  for(const source of ['https://other.example.com'+imagePath,config.site+'/image.png','data:image/png;base64,example','javascript:example'])assert.equal(tapdImagePath(source,config.site),undefined);
});

for(const [name,metadata,response] of [
  ['wrong project',{workspace_id:'unconfigured',download_url:download},null],
  ['unsafe URL',{download_url:'file:///etc/example'},null],
  ['credential URL',{download_url:'https://user:password@files.example.com/example.png'},null],
  ['configured credential in URL',{download_url:download+'?token='+encodeURIComponent(config.token)},null],
  ['HTML response',{download_url:download},()=>new Response('<html>login</html>',{headers:{'content-type':'image/png'}})],
  ['oversize declared',{download_url:download},()=>new Response(image,{headers:{'content-length':String(9*1024*1024)}})],
  ['oversize streamed',{download_url:download},()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(8*1024*1024));controller.enqueue(new Uint8Array(1));controller.close();}}))],
  ['unsafe redirect',{download_url:download},()=>new Response('',{status:302,headers:{location:'file:///etc/example'}})],
])test(`protected image rejects ${name} without leaking upstream content`,async t=>{
  clearTapdCache();t.mock.method(globalThis,'fetch',async input=>new URL(input).origin===config.endpoint?Response.json({status:1,data:{Attachment:metadata}}):response());
  await assert.rejects(fetchContentImage(config,'12345678',imagePath),{message:failure});
});

test("download redirects keep credentials absent and validate each location",async t=>{
  clearTapdCache();let count=0;
  t.mock.method(globalThis,'fetch',async(input,init)=>{
    if(new URL(input).origin===config.endpoint)return Response.json({status:1,data:{Attachment:{download_url:download}}});
    count++;assert.equal(init.headers,undefined);
    return count===1?new Response('',{status:302,headers:{location:'https://cdn.example.com/image.png'}}):new Response(image);
  });
  assert.ok((await fetchContentImage(config,'12345678',imagePath)).dataUri.startsWith('data:image/png;base64,'));assert.equal(count,2);
});
