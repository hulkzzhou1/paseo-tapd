import assert from "node:assert/strict";
import { test } from "node:test";
import { isCurrentIteration } from "../shared/iterations.ts";
import { clearTapdCache, fetchIterations } from "../server/tapd.ts";

test("current iterations use inclusive local dates, exclude closed/missing/invalid dates", () => {
  const current = {status:"open",startDate:"2026-01-15",endDate:"2026-01-15"};
  const now = new Date(2026,0,15,23,59);
  assert.equal(isCurrentIteration(current,now),true);
  for(const patch of [{status:"done"},{status:"closed"},{startDate:"2026-01-16"},{endDate:"2026-01-14"},{startDate:""},{endDate:undefined},{startDate:"2026-02-31"},{endDate:"2026-99-99"}]) assert.equal(isCurrentIteration({...current,...patch},now),false);
});

test("iteration candidates request and retain start/end dates across projects", async t => {
  clearTapdCache();
  t.mock.method(globalThis,"fetch",async input=>{
    const url=new URL(input);
    assert.equal(url.searchParams.get("fields"),"id,name,status,startdate,enddate");
    return Response.json({status:1,data:[{Iteration:{id:url.searchParams.get("workspace_id"),name:"示例迭代",status:"open",startdate:"2026-01-01",enddate:"2026-01-15"}}]});
  });
  const rows=await fetchIterations({endpoint:"https://api.example.com",site:"https://example.com",token:"",tokenSource:"none",workspaceIds:["12345678","87654321"]});
  assert.equal(rows.length,2);
  for(const row of rows)assert.deepEqual({startDate:row.startDate,endDate:row.endDate},{startDate:"2026-01-01",endDate:"2026-01-15"});
});
