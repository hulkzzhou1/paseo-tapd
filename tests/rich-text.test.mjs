import assert from "node:assert/strict";
import { test } from "node:test";
import { contentUrl, parseRichText } from "../shared/rich-text.ts";
import { clearTapdCache, fetchEntity, htmlToText } from "../server/tapd.ts";

const base = "https://example.com/project/item";
const text = nodes => nodes.map(node => (node.text ?? "") + text(node.children)).join("");
const tags = nodes => nodes.flatMap(node => [node.tag, ...tags(node.children)]);

test("reading structure retains headings, lists, code, tables and links without executing HTML", () => {
  const nodes = parseRichText('<h2>阅读标题</h2><p>段落 <strong>重点</strong> &amp; &#x4e2d;</p><ol><li>第一项</li><li>第二项</li></ol><blockquote>引用</blockquote><pre><code>a\n  b</code></pre><table><tr><th>字段</th><td>值</td></tr></table><a href="/help">说明</a>', base);
  for (const tag of ["h2", "p", "strong", "ol", "li", "blockquote", "pre", "code", "table", "tr", "th", "td", "a"]) assert.ok(tags(nodes).includes(tag));
  assert.ok(text(nodes).includes("& 中"));
  assert.ok(text(nodes).includes("a\n  b"));
  assert.equal(nodes.at(-1).href, "https://example.com/help");
});

test("scripts, styles, embedded content and unsafe links are inert; image sources are safe URLs", () => {
  const nodes = parseRichText('<script>private-script-text</script><style>private-style-text</style><iframe>private-frame-text</iframe><p onclick="attack()">保留正文</p><a href="java&#115;cript:alert(1)">危险链接</a><img src="/image.png" alt="示例图片" onerror="attack()">', base);
  assert.equal(text(nodes), "保留正文危险链接示例图片");
  assert.equal(nodes[1].href, undefined);
  assert.equal(nodes[2].href, "https://example.com/image.png");
  assert.equal(nodes[2].text, "示例图片");
  assert.deepEqual(Object.keys(nodes[0]).sort(), ["children", "tag"]);
  for (const url of ["javascript:alert(1)", "data:text/html,example", "file:///tmp/example", "https://user:password@example.com", "https://example.com/\nsecret"]) assert.equal(contentUrl(url, base), undefined);
});

test("complete long text and deeply nested safe content remain readable", () => {
  const long = "正文内容".repeat(2000);
  assert.equal(text(parseRichText(long, base)), long);
  const nested = "<div>".repeat(100) + long + "</div>".repeat(100);
  assert.equal(text(parseRichText(nested, base)), long);
});

test("entity boundary returns complete original description/comments and a separate plain snapshot", async t => {
  clearTapdCache();
  const description = '<h2>标题</h2><p>' + "正文".repeat(3000) + '</p>';
  const comment = '<p>' + "评论".repeat(700) + '</p>';
  t.mock.method(globalThis, "fetch", async input => {
    const url = new URL(input);
    const data = url.pathname === "/tasks" ? [{Task:{id:"12345678",name:"示例任务",status:"open",description}}]
      : url.pathname === "/comments" ? [{Comment:{id:"87654321",author:"example-member",description:comment}}] : [];
    return Response.json({status:1,data});
  });
  const result = await fetchEntity({endpoint:"https://api.example.com",site:"https://example.com",token:"",tokenSource:"none",workspaceIds:["12345678"]}, "task", "12345678");
  assert.equal(result.descriptionHtml, description);
  assert.equal(result.description, htmlToText(description));
  assert.ok(result.description.length > 4000);
  assert.equal(result.comments[0].html, comment);
  assert.ok(result.comments[0].text.length > 800);
  assert.equal(htmlToText('<script>removed</script><p>保留</p>'), "保留");
});
