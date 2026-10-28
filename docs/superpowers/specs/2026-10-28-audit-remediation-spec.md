# TAPD 审计修复：移除 Git 同步、安全边界与看板缓存

状态：用户已确认两个公开验证边界，并要求移除 Git 备份功能；规格可供后续拆票。

## Problem Statement

现有 TAPD 工作台已提供主要负责 Agent、任务看板、真实子单据、通用标签和会话恢复，但整仓审计复现了十项问题。原有自动检查全部通过，仍不能保证界面、真实 RPC、存储及网络操作串联后的行为正确。

凭据可能经 Git 备份、详情返回或评论正文暴露；Git 恢复可能跟随仓库中的符号链接读取克隆目录外的 JSON；基础写入 RPC 未统一限制配置项目。用户直接指派的看板任务可能因缺少历史查看记录而无法打开。读取缓存混用凭据，旧工作台请求可能在失效后重新填回缓存；Git 恢复还会使用保存连接前的旧设置修订，导致恢复失败。长会话每次新增卡片会重新扫描全部历史，已过期及零有效期读取也可能持续占用缓存。

用户随后决定去掉 Git 备份功能。因此，审计 1、2、8 不再通过完善备份与恢复流程修复，而是整体移除配置 Git 备份、恢复和自动备份能力。其余七项继续修复，保留既有 TAPD 工作流、唯一承担关系、最近查看、历史卡片及明确授权规则。

## Solution

移除配置 Git 同步的设置区、连接字段、推送/拉取 RPC、自动备份定时器及后端克隆/读写/推送实现，不保留可触发同步的隐藏入口。旧配置能兼容升级，现有本地连接、视图、收藏、看板布局、承担关系和会话数据保留；不联系或删除用户的远端备份仓库。

统一注册工具和界面 RPC 的凭据、项目及目标校验，让用户从真实看板任务或子单据直接打开详情，并确保新会话不必先产生历史查看记录。

所有缓存按实际连接及凭据作用域隔离；失效前的请求不能重新发布过时结果。正常新增卡片直接展示本次结果，完整历史扫描用于恢复场景。短期读取缓存有确定容量与清理行为，不把零有效期响应长期保存。

实施顺序以原审计编号为依据：先移除 Git 同步能力（替代 1、2、8），并修复 3–4 的凭据和项目边界，再完成 5–7 的导航与缓存正确性，最后完成 9–10 的历史扫描和缓存容量修复。具体子任务及依赖在后续拆票阶段确认。

## User Stories

1. As a user, I want the Git backup and restore settings section removed, so that the plugin no longer offers configuration synchronization.
2. As a user, I want Git URL, token and branch inputs removed, so that unused connection fields do not remain in the product.
3. As a user, I want push and pull RPCs unregistered, so that an old client cannot activate the removed feature directly.
4. As a user, I want automatic backup timers removed, so that saving settings cannot contact a Git remote.
5. As a user, I want the configuration clone, file import/export and push implementation deleted, so that its credential and file-read risks disappear with the feature.
6. As a user, I want old sync configuration to load safely after upgrade, so that removing fields does not invalidate all plugin settings.
7. As a user, I want my existing local connection, views, favorites and layout preserved, so that feature removal does not reset my workbench.
8. As a user, I want responsibility, recent viewing and historical cards preserved, so that removing backup does not erase task data.
9. As a user, I want existing remote backups left untouched, so that removing a plugin feature does not delete my external data.
10. As a user, I want detail titles, descriptions and comments protected before reaching the UI, so that RPC reads do not bypass tool-output safeguards.
11. As an Agent, I want registered tools and direct RPCs to enforce the same credential rule, so that callers cannot select a weaker path.
12. As a user, I want protected values rejected from comment input before a POST, so that output redaction does not occur after a permanent leak.
13. As a user, I want fixed safe errors instead of upstream payloads or local paths, so that failures do not disclose sensitive content.
14. As a user, I want unsafe read results to remain explicit failures, so that hidden data is not presented as empty or nonexistent.
15. As a user, I want every write constrained to configured projects, so that stale UI targets cannot write to an excluded project.
16. As a user, I want standalone creation checked before its POST, so that child-creation safeguards are not the only project protection.
17. As a user, I want status and comment targets checked before writing, so that UI RPCs preserve the same project boundary as Agent tools.
18. As a user, I want existing items resolved to their actual configured project, so that a supplied project does not silently redirect a write.
19. As a user, I want the existing default-project behavior retained where the target project is genuinely unspecified, so that compatible creation workflows keep working safely.
20. As a user, I want accepted, unverified and unknown write outcomes retained, so that validation or presentation changes do not cause automatic resubmission.
21. As a user, I want a newly assigned task to open directly from its Agent's board, so that no prior query is required.
22. As an Agent, I want tasks accepted through delegation to be directly reachable, so that the target conversation does not need a historical result card first.
23. As a user, I want a newly expanded child item to open its own details, so that parent navigation works before the child has been viewed.
24. As a user, I want the server to verify new navigation targets and retrieve their summaries, so that forged client titles, states or labels are not trusted.
25. As a user, I want opening an item to add recent viewing without taking responsibility, so that navigation does not change task membership.
26. As a user, I want historical cards and existing scoped navigation to remain usable, so that fixing first access does not rewrite conversation history.
27. As a user, I want each connection test to validate the supplied credential, so that a cached successful account cannot validate an invalid token.
28. As a user, I want concurrent reads with different credentials isolated, so that they do not share another account's in-flight response.
29. As a user, I want endpoint, project and credential changes reflected in cache identity, so that one connection cannot publish another connection's results.
30. As a user, I want cache identity to avoid raw credentials, so that fixing isolation does not expose tokens in cache keys or diagnostics.
31. As a user, I want all callers to keep the same identity and error semantics on cached reads, so that a cache hit cannot bypass configuration validation.
32. As a user, I want an accepted write to invalidate previous workbench reads, so that an older request cannot restore the previous status.
33. As a user, I want a connection change to invalidate work already running, so that a late response cannot look like fresh data for the new connection.
34. As a user, I want forced and background refreshes to obey the same invalidation rule, so that one refresh path cannot reintroduce stale results.
35. As a user, I want completion of an old request not to clear a newer in-flight entry, so that refresh tracking remains accurate.
36. As a user, I want retained stale data to keep its original timestamp and scope, so that it is never relabelled as fresh or moved across connections.
37. As a user, I want settings containing old sync fields to migrate without cloning or reading a repository, so that upgrade is a local operation.
38. As a user, I want any readable legacy Git credential handled as a deprecated secret, so that removing its UI does not turn it into ordinary display data.
39. As a user, I want ordinary settings saves to retain revision conflict checks without triggering backups, so that local edits remain safe.
40. As a user, I want Git repository selection and worktree creation for Agent dispatch to keep working, so that removing configuration backup does not remove task execution capabilities.
41. As an Agent, I want a normal new result card appended without scanning the whole conversation, so that long histories do not slow every tool call.
42. As a user, I want full card recovery retained on startup or reconnect, so that optimizing the normal path does not lose historical presentation.
43. As a user, I want partial presentation failures to recover stored cards without repeating TAPD writes, so that reliability work cannot duplicate business operations.
44. As an Agent, I want another conversation's history recovery not to block my normal new cards, so that one long conversation does not stall unrelated work.
45. As a user, I want zero-lifetime responses excluded from retained response caches, so that reads with no reuse benefit do not accumulate.
46. As a user, I want expired entries reclaimed and cache capacities bounded, so that a daemon can run for weeks without retaining every past query.
47. As a user, I want eviction to affect performance only, so that it never removes responsibility or conversation history.
48. As a user, I want cache misses after eviction to read actual data, so that capacity limits cannot invent empty results or completed tasks.
49. As a maintainer, I want regression tests to drive the actual registered handler and UI chain, so that unconditional-success mocks cannot hide these failures again.
50. As a maintainer, I want one failing command for each audited behavior before its fix, so that passing tests prove a repaired symptom rather than merely a runnable fixture.

## Implementation Decisions

### Preserve the existing domain and authorization

- TAPD workflow status remains the sole business state. Confirmed responsibility remains the source of 看板任务; 最近查看, historical cards and pending legacy ownership remain separate.
- Preserve one primary Agent per scoped item, real child relationships, generic labels, explicit write authorization, partial dispatch reporting and the existing lifecycle recovery rules.
- A navigation read, cache refresh, settings migration or recovery operation never creates responsibility, advances a status, adds a label, posts a comment or sends an Agent prompt.
- Reuse existing schemas, registered tools, RPCs, local storage and UI components. Add no framework, dependency, user-facing cache configuration or new production diagnostics API.

### Remove configuration Git sync — replaces audit 1, 2 and 8

- Delete the sync settings UI, Git connection inputs, push/pull RPC contracts and registrations, automatic backup debounce/timers and the configuration Git transport/import/export implementation. Disabling buttons while leaving callable backend paths is insufficient.
- Settings subscriptions retain necessary cache invalidation but no longer schedule Git work. Initialization, ordinary settings changes, reload and legacy-field migration must not clone, import, commit, push or contact a backup remote.
- Use the existing public settings migration contract to accept older saved settings and retire obsolete sync fields without resetting unrelated values. Do not add a new compatibility service, replacement export feature or hidden enable switch.
- Remove sync-only callers, helpers and fixtures. Update current README, overview, manifest and skill claims where applicable; historical design records may retain clearly superseded descriptions. No current instructions should direct users to Git backup controls.
- Preserve local TAPD credentials, project/connection configuration, views, favorites, layout, responsibility and conversation storage. Existing remote backups and local backup copies are not deleted, rewritten or fetched during removal.
- The change removes only configuration backup/sync. Agent dispatch still selects existing Git projects and creates worktrees through the SDK; normal source-repository Git workflows are unchanged.

### Shared credential boundary — audit 3

- Use one complete protected-values set containing the configured TAPD credential and active or overridden daemon TAPD credential. Any legacy Git credential still readable during compatibility handling remains a deprecated protected value: never display, inject, transmit or reinterpret it as ordinary business text. Do not introduce a new secret-storage subsystem to retain removed fields.
- Reuse existing serialization-aware protection rather than another literal-string implementation, including credentials containing JSON escape characters.
- Read protection applies to complete public RPC outputs as well as registered tool results. Protected detail text cannot bypass the policy merely because the caller is a UI. Reject unsafe data with a fixed safe error; existing explicitly safe partial-summary behavior may remain without inventing empty business data.
- Comment input is checked before its POST, using the same credential policy as other controlled writes. Later result redaction is not a substitute for pre-write validation.
- No new network destination is introduced. Configuration Git authentication, temporary clones and repository-file reading disappear with the removed feature rather than receiving new implementations.

### Project and actual-item boundaries — audit 4

- Put configured-project checks in the shared creation, status and comment path before any POST, rather than relying on the Agent-tool wrapper or client input alone.
- An explicitly supplied unconfigured project is rejected without business writes, even if the TAPD credential would permit that project remotely. Retain the existing bounded numeric target validation and actual-item identity checks.
- Existing item operations resolve and validate the actual project. Standalone creation may retain the first-configured-project fallback only when no explicit or known actual project exists; it must not turn a failed target lookup into a guessed write.
- Preserve explicit user authorization and the distinction between not sent, rejected, accepted/verified, accepted/unverified and unknown. Presentation, storage or read-back failure never causes a write retry.

### First access from board and child navigation — audit 5

- Remove the requirement that a valid board or child target already exist in recent viewing or historical cards before opening details.
- Server-side focus validates the accessible Agent, configured connection, actual project, kind and item identity. For a new reference, retrieve the canonical summary through the existing configured TAPD reader; do not accept client-supplied titles, statuses, owners or labels as authoritative.
- Direct assignment, accepted delegation and child expansion must all support first access. Successful opening may update recent viewing but must not create or transfer responsibility.
- Preserve reuse of the complete detail tab, current read-only failure feedback, known-reference metadata safeguards and historical result-card snapshots.

### Cache isolation and invalidation — audit 6–7

- Resolve and validate current configuration before selecting a workbench cache entry. Cache keys include all result-affecting connection, project, credential and request identities; request parameters already encoded in a URL may be reused as part of that identity.
- Use a nonreversible credential fingerprint; never place raw credentials in keys or diagnostic output. Requests already running must use the same isolation as retained responses.
- Draft connection tests must validate the draft credential with its own identity. A previous successful user response must not validate another token or hide its authentication failure.
- Cache invalidation advances a generation or equivalent existing mechanism. A forced or background read started before invalidation cannot repopulate the current cache or be marked fresh in the new scope.
- Completion cleanup removes only the matching request entry, not a newer refresh registered under the same key. Cover both settings changes and accepted write invalidation, including failures after the write was accepted.
- Keep stale fallback only within its original scope and with its original successful timestamp. A refresh failure does not remove responsibility or reinterpret uncertain data as completed.

### Local settings compatibility after removal

- Do not repair or retain the two-step Git Pull/settings-save flow from audit 8; remove that flow entirely.
- Ordinary settings changes and schema migration continue to respect SDK revision checks. Do not clear the entire settings document, overwrite concurrent changes or replay obsolete sync actions to remove retired fields.
- Old clients invoking removed sync RPC names receive a safe unavailable/unsupported result and produce no backup side effects. Do not retain a silent success shim that implies data was backed up or restored.

### Card presentation and bounded caches — audit 9–10

- Persist a new result using the existing safe storage boundary, then append that card during normal operation without a complete timeline scan. Preserve stable card identity, duplicate prevention and accepted-write presentation warnings.
- Full scans remain available for actual startup, reconnect, replacement or uncertain presentation recovery. A long recovery in one Agent must not globally serialize unrelated Agents' normal new-card presentation.
- Keep recovery read-only with respect to TAPD and Agent execution. No business operation is replayed to reconstruct a card.
- Do not retain response-cache entries for zero-lifetime reads. Expired entries are reclaimed and response/workbench caches have finite internal capacities, using the existing bounded-cache policy as prior art. Do not add user settings for these limits.
- Cache eviction must not touch durable responsibility, suppression, local history, recent viewing or stored result cards. It creates an ordinary cache miss, followed by a correctly scoped read.

### Delivery and compatibility

- Work against the fork's GitHub Issues and preserve the current documented beta/main SDK contract. No daemon upgrade or unsupported stable-version claim is part of these fixes.
- Update user documentation, plugin overview, manifest descriptions and bundled skill together wherever their described behavior changes. Package version, lockfile version and update-check version are bumped together at implementation delivery, not while writing this specification.
- Carry each relevant audit reproduction into the implementation ticket as desensitized evidence and a deterministic failing check. A green unit suite or a successful helper call alone does not demonstrate the end-to-end requirement.

## Testing Decisions

用户已确认以下两个公开行为边界；移除 Git 功能后，在相同边界验证入口和副作用消失，而不再验收 Git 备份/恢复成功。夹具仅使用合成数据、临时 home、可控 HTTP 与时钟，不访问生产 TAPD、真实 Git 远端或实际 Agent provider。

1. **Registered tools and actual RPC/data operations.** Exercise real registered schemas and shared handlers with isolated persistence. Verify sync RPCs are no longer registered, older settings load/migrate safely, and initialization/settings changes produce no configuration Git subprocesses, repository reads or backup network requests. Verify direct RPC and registered-tool parity, protected comment input, and zero POSTs for excluded-project creation/status/comments. Exercise the actual read path with different credentials, overlapping reads, forced/background refreshes and invalidation before completion. Preserve ordinary settings revision conflicts, accepted/unverified results and no replay. Performance checks assert observable HTTP/timeline calls and bounded retention using controlled time; they do not require a production-only cache inspection interface.
2. **Actual UI connected to real RPC behavior.** Drive direct assignment or accepted delegation, open the target Agent's board and click its previously unviewed task into full details. Expand and open a previously unviewed child. Verify backup/restore/automatic-backup controls and sync credential inputs are absent, ordinary settings still save against the real revision boundary, and legacy local values survive upgrade. Assert visible success/failure, recent viewing, unchanged responsibility, accessible actions and existing detail operations. The focus and ordinary settings-save operations under test must not be replaced by unconditional-success mocks; a fast fixture may replace only external TAPD and provider execution. Keep Agent dispatch's Git project/worktree behavior distinct from removed configuration sync.

Every correction starts with a regression that fails for the observed wrong behavior on the audited baseline, then passes after the fix. Existing temporary audit scripts are evidence to convert into assertions, not already-complete regression tests merely because their process exits successfully.

Required deterministic scenarios include:

- Older settings containing a backup URL, branch and synthetic Git credential. Loading, migration, ordinary saves and elapsed debounce time must not invoke configuration Git, read repository settings or contact a backup endpoint; unrelated settings and task data remain available.
- Calls to removed push/pull RPC names and absence of their UI controls. A legacy remote or repository-file/symlink fixture must not be opened at all. Do not replace removed feature tests with tests of dead private helpers.
- A detail response echoing each protected value, a comment input containing one, and both tool/RPC callers. Comment rejection occurs before POST.
- Each basic write with an explicitly excluded project, valid configured targets and safe unspecified-project fallback. Assert actual request project and absence of unintended writes.
- A directly assigned task with no target-Agent history, an accepted delegation with no target card, and a first child navigation. Verify canonical metadata, complete details and no take-on-read.
- Account A's cached user followed immediately by invalid account B, simultaneous A/B reads, and connection/project changes. A's result cannot authenticate or satisfy B's request.
- A held old board request, cache invalidation, a newer result and then the old completion, for both forced and background paths. The old result cannot become current or delete the newer request entry.
- Ordinary settings saves, a concurrent local edit and a schema-migration conflict retain the SDK's revision protection without initiating backup. Existing Agent dispatch project selection/worktree creation remains available.
- A recovered conversation with 10,000 existing timeline entries followed by a normal new card. The normal append must not scan the complete history; a separate recovery scenario must still reconstruct missing cards without TAPD writes. A second Agent's normal append remains independent of a held recovery.
- At least 1,000 distinct zero-lifetime summaries and varied workbench queries, controlled expiry, capacity pressure and a post-eviction re-read. Retained caches must remain bounded and expired data must not become fresh.

容量与过期测试优先通过达到上限后重读产生的真实网络行为验证；零有效期响应是否仍被保留，可在隔离 Node 进程通过保留对象或堆观测验证，不给生产模块增加缓存内容查询接口。仅证明重复读取重新发出 HTTP，不能证明旧响应未留在内存。

Run appropriate existing checks, typecheck and lint after integration. Re-run affected real UI chains and the original reproductions; broaden daemon recovery testing only if the fix changes that lifecycle path. Do not claim human visual inspection or production permission validation from fixture success.

## Out of Scope

- New TAPD features, a second task state machine, new Matt label rules, automatic responsibility or additional business writes.
- Redesigning the card layout, changing the approved two-label/+N display, or rewriting historical cards to fresh values.
- New dependencies, generalized storage/cache frameworks, public debugging endpoints, configurable cache administration, replacement backup/export/import features or a new Git authentication system.
- Rewriting remote Git history, rotating user credentials, removing historical leaked data, or silently repairing arbitrary external repositories.
- Changing accepted limitations for native visible-only refresh, final-label clearing, TAPD external-editor atomicity or independent-host ownership.
- Production TAPD writes, live Git pushes, Agent messages, local plugin reload, daemon restart or registry/community publication as part of specification creation.
- Full architectural refactoring or the retrospective itself; follow-up retrospective recommendations are separate work after the fixes.

## Further Notes

Audit baseline: `9c2239657e3a252a880ff0120f4c79daf524cb82`, plugin version 0.4.41. The existing 173 tests and typecheck passed; lint reported four existing warnings. That evidence is not acceptance of the newly reproduced scenarios.

All audit probes used synthetic TAPD HTTP or local Git with external transports disabled. Reproductions confirmed credential-bearing backup data, an outside-file restore read, protected detail/comment text, three excluded-project fixture POSTs, an assigned board item rejected by focus, credential cache reuse, late board cache repopulation and stale settings revision reuse. A 10,000-entry conversation required 51 history pages for another normal card; 1,000 zero-lifetime summary responses remained cached after the fixture clock advanced an hour.

用户追加决定：整体去掉配置 Git 备份能力。原审计 1、2、8 通过删除对应功能及所有可触发路径解决，不再保留原备份安全、符号链接读取或 Pull 修订保存的成功流程需求；原审计 3、4、5、6、7、9、10 继续按本规格修复。

This specification preserves the approved Agent task-board domain and existing relationship-storage decision. It addresses the original audit through one feature removal and seven remaining fixes, without treating previous review or green test totals as acceptance of the newly connected paths.

No implementation or runtime change is performed by publishing this specification. Task decomposition and its dependency graph remain for the subsequent to-tickets step.
