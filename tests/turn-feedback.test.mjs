import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
registerHooks({ resolve(s,c,next) { try { return next(s,c); } catch(e) {
  if(e.code === "ERR_MODULE_NOT_FOUND" && s.startsWith(".") && !/\.[a-z]+$/.test(s)) return next(s + ".ts",c);
  throw e;
} } });
const { default: contribute } = await import("../index.server.ts");
const { tapdSettingsSchema } = await import("../shared/contracts.ts");
for(const key of ["TAPD_TOKEN","TAPD_API_ENDPOINT","TAPD_SITE_URL","TAPD_WORKSPACE_IDS"]) delete process.env[key];

test("ordinary ended turns never post business comments even with a legacy enabled setting", async t => {
  const values = tapdSettingsSchema.parse({ token:"example-secret", workspaceIds:"12345678", autoReportAgentResult:true,
    links:[{key:"story-11111111",kind:"story",id:"11111111",agentId:"example-agent",workspaceId:"example-workspace"}] });
  const events=new Map(), rpcs=new Map(), requests=[];
  t.mock.method(globalThis,"fetch",async(input,init)=>{
    requests.push(init?.method);
    return Response.json({status:1,data: new URL(input).pathname==="/stories" ? [{Story:{id:"11111111"}}] : []});
  });
  const close=contribute({registerSettings:()=>({read:async()=>({status:"ready",values}),subscribe:()=>()=>{}}),
    before(){},on:(name,fn)=>events.set(name,fn),handle:(rpc,fn)=>rpcs.set(rpc.name,fn)});
  try {
    for (const kind of ["completed","failed","canceled"]) {
      await events.get("agent.turn_ended")({agent:{id:"example-agent"},turnId:null,
        outcome:{kind,error:{message:"private example-secret"}}, timeline:[{type:"assistant_message",text:"上轮完成，不能用于本轮"}]});
      await new Promise(resolve=>setImmediate(resolve));
      const status=await rpcs.get("tapd.agent_status")({agentIds:["example-agent"]},{paseo:{agents:{list:async()=>({entries:[]})}}});
      assert.equal(status.items[0].turnOutcome,kind);
      assert.equal(status.items[0].turnSummary,"", "no unscoped history is presented as current-turn output");
      assert.equal(JSON.stringify(status).includes("example-secret"),false);
    }
    assert.equal(requests.length,0,"turn feedback must not contact TAPD");
  } finally { close(); }
});
