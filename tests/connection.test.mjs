import assert from "node:assert/strict";
import { test } from "node:test";
import { entityUrl, resolveConfig } from "../server/tapd.ts";
import { tapdSettingsSchema, tapdBaseUrlSchema } from "../shared/contracts.ts";
import { managedValues } from "../server/git-sync.ts";

const settings = { token: "", workspaceIds: "12345678" };

test("explicit addresses override daemon defaults and drive item links", () => {
  const config = resolveConfig({ ...settings, apiEndpoint: " https://api.example.com/v1/ ", siteUrl: "https://example.com/" });
  assert.equal(config.endpoint, "https://api.example.com/v1");
  assert.equal(entityUrl(config, "12345678", "story", "1"), "https://example.com/tapd_fe/12345678/story/detail/1");
});

test("blank addresses use environment variables, then public defaults", (t) => {
  const previous = { api: process.env.TAPD_API_ENDPOINT, site: process.env.TAPD_SITE_URL };
  t.after(() => {
    for (const [key, value] of [["TAPD_API_ENDPOINT", previous.api], ["TAPD_SITE_URL", previous.site]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  process.env.TAPD_API_ENDPOINT = "https://api.example.com/";
  process.env.TAPD_SITE_URL = "https://example.com/";
  let config = resolveConfig({ ...settings, apiEndpoint: "", siteUrl: "" });
  assert.equal(config.endpoint, "https://api.example.com");
  assert.equal(config.site, "https://example.com");
  delete process.env.TAPD_API_ENDPOINT;
  delete process.env.TAPD_SITE_URL;
  config = resolveConfig(settings);
  assert.equal(config.endpoint, "https://api.tapd.cn");
  assert.equal(config.site, "https://www.tapd.cn");
});

test("invalid or credential-bearing addresses fail without echoing the input", () => {
  for (const value of ["example.com", "file:///example", "javascript:example", "https://example:example@example.com", "https://example.com?example=value", "https://example.com#example"]) {
    assert.equal(tapdBaseUrlSchema.safeParse(value).success, false);
    assert.throws(() => resolveConfig({ ...settings, apiEndpoint: value }), { message: "TAPD 地址需为完整 HTTP(S) URL，不能包含账号、密码、查询参数或片段" });
  }
});

test("old settings keep working and private addresses stay out of Git backups", () => {
  const old = tapdSettingsSchema.parse({});
  assert.equal(old.apiEndpoint, "");
  assert.equal(old.siteUrl, "");
  const managed = managedValues({ ...old, apiEndpoint: "https://api.example.com", siteUrl: "https://example.com" });
  assert.equal("apiEndpoint" in managed, false);
  assert.equal("siteUrl" in managed, false);
});
