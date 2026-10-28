# Agent TAPD 任务看板与通用标签工具

## Problem Statement

当前会话 TAPD 侧栏主要记录对话中访问过的单据。查询、链接和工具结果都可能进入列表，用户和 Agent 无法据此判断哪些工作已经接手、谁是主要负责人，以及哪些单据尚未完成。现有绑定允许同一单据关联多个 Agent，缺少唯一负责人、转交和历史冲突处理规则；Agent 也没有与侧栏一致的任务看板查询能力。

用户希望将侧栏作为当前 Agent 的实际任务看板。所有业务状态使用 TAPD 原有工作流，多阶段和多 Agent 的独立交付通过真实子单据拆分。同时需要通用标签工具，以便 Matt 等技能自行维护额外流程标签，不把某套技能的标签规则写入插件。

## Solution

输入框上方 TAPD 入口打开当前 Agent 的任务看板。正式任务来自明确的承担关系，查看记录保留为次级入口。每张实际 TAPD 单据在同一 Paseo 主机和 TAPD 连接范围内只有一个主要负责 Agent。其他 Agent 可以查看、协助和发起明确委派，目标 Agent 接手后才形成承担关系；用户直接指派不自动启动 Agent 执行。

看板默认显示未完成，提供已完成及对应数量。分类来自实际项目、单据类型的 TAPD 工作流，不由回合结束、标签、Agent 运行状态或本地完成按钮推断。读取或判定失败显示状态待确认或过期数据，不伪造状态。父需求展开真实任务和子需求及其负责人；子单据完成不直接完成父需求。

增加与界面一致的看板查询及接手、退出、转交能力，统一现有绑定和派发入口的规则。完成和返工复用现有授权状态工具。增加项目标签查询与创建、单据标签读取与添加/移除能力，保留无关标签，由调用方决定标签含义。

## User Stories

1. As a user, I want the conversation TAPD entry to open the current Agent's task board, so that I can see its actual responsibilities.
2. As an Agent, I want to query my own board without supplying my identity, so that I can discover my assigned work reliably.
3. As a collaborating Agent, I want to query a specified Agent's board, so that I can coordinate work without acquiring mutation rights.
4. As a user, I want mere reads and message links to stay outside assigned work, so that discussion does not create obligations.
5. As an Agent, I want to accept an explicitly delegated item, so that my board reflects work I have taken on.
6. As a user, I want to assign an existing Agent directly without starting execution, so that I control when work begins.
7. As a user, I want confirmed dispatch to a new Agent to retain its existing explicit-start behavior, so that assignment and execution are intentional.
8. As an Agent, I want duplicate acceptance of my own item to be idempotent, so that retries do not duplicate cards or history.
9. As an Agent, I want acceptance to fail when another Agent owns the item, so that responsibilities remain unambiguous.
10. As a user, I want concurrent acceptance to produce one owner, so that competing Agents cannot both take responsibility.
11. As a user, I want the current owner to be identified on conflict, so that I can choose collaboration or transfer.
12. As a user, I want to authorize a transfer explicitly, so that responsibility can move without editing TAPD people or status.
13. As an owning Agent, I want to hand over work only after the target accepts, so that work is not silently assigned elsewhere.
14. As an Agent, I want to leave my assigned item with a reason, so that I no longer appear responsible while TAPD data stays intact.
15. As a user, I want ownership changes to preserve actor, time and reason locally, so that I can understand how responsibility changed.
16. As a user, I want unfinished and completed counts based on TAPD workflows, so that the board agrees with the project.
17. As a user, I want custom statuses interpreted within their project and item kind, so that equal names or keys do not mix workflows.
18. As an Agent, I want ended turns and submitted phase results not to complete items automatically, so that acceptance remains meaningful.
19. As a user, I want completion and reopening to use real authorized TAPD transitions, so that there is one business status source.
20. As an Agent, I want to create actual tasks under a requirement, so that independently deliverable work can be assigned separately.
21. As an Agent, I want to create actual child requirements when the project permits them, so that larger phases can be split appropriately.
22. As a user, I want parent-child project and type rules checked before creation, so that children attach to the intended requirement.
23. As a parent-owning Agent, I want to inspect child items and their owners without owning each child, so that I can coordinate progress.
24. As a user, I want child completion not to imply parent completion, so that project workflow rules remain authoritative.
25. As a user, I want partial or truncated child lists identified, so that missing results are not interpreted as no work.
26. As a user, I want compact two-column cards with a single-column narrow layout, so that the board uses space efficiently.
27. As a user, I want card titles, real TAPD status and responsible Agent to be clear, so that I can identify the next item quickly.
28. As a user, I want any item to open the existing full detail tab and operations, so that the board preserves current capabilities.
29. As a user, I want linked work above long descriptions, so that the responsible Agent is easy to reach.
30. As a user, I want assignment buttons hidden for an already assigned item, so that the UI does not encourage duplicate ownership.
31. As a user, I want latest status on opening, manual refresh and visible-board refresh every 30 seconds, so that the board remains useful.
32. As an Agent, I want successful status changes reflected immediately, so that tool results and the UI agree.
33. As a user, I want failed refreshes to preserve clearly dated previous data, so that temporary failures do not erase work.
34. As a user, I want unread or unclassifiable items shown as uncertain, so that they are not silently counted as unfinished or completed.
35. As a user, I want historical bindings presented for confirmation, so that old associations do not become obligations automatically.
36. As a user, I want conflicting historical bindings retained until I choose an owner, so that migration does not lose evidence or guess.
37. As a user, I want ordinary historical references available under recent viewing, so that the redesign preserves navigation history.
38. As a user, I want close, reopen and daemon restart to restore my board, so that assigned work follows the conversation.
39. As a user, I want archived conversations to retain their boards, so that later restoration is possible.
40. As a user, I want deleting a conversation to clear its board and responsibility, so that other boards show the item as unassigned without changing TAPD.
41. As a user, I want host, connection, project, item kind and Agent boundaries respected, so that work and credentials are not mixed.
42. As an Agent, I want project labels and current item labels available through tools, so that I can use existing project vocabulary.
43. As a user, I want explicit project-label creation, so that new labels can be prepared without editing an item.
44. As an Agent, I want to add and remove selected item labels while retaining other labels, so that I do not overwrite human classification.
45. As an Agent, I want a duplicate add or missing-label removal to report no change, so that label operations are idempotent when possible.
46. As a skill author, I want label names and conventions to remain generic, so that Matt or other workflows can choose their own meanings.
47. As a user, I want label writes confirmed and read back, so that accepted, verified, rejected and uncertain results are distinguishable.
48. As a user, I want unread label values to differ from an empty label set, so that a missing response cannot accidentally clear labels.
49. As a user, I want timeouts, partial dispatch and presentation failures not to replay writes, so that recovery avoids duplicate work.
50. As a user, I want task and label tools documented in the plugin workflow skill, so that Agents use the new capabilities correctly.

51. As a user, I want real TAPD labels on task cards, so that I can see additional workflow context at a glance.
52. As a user, I want at most two labels and a +N indicator on compact cards, so that many labels do not expand every card.
53. As a user, I want full labels in item details, so that I can inspect all context without a label editor.
54. As a user, I want missing labels distinguished from confirmed empty labels, so that unavailable data does not silently look unlabelled.

## Implementation Decisions

### Business model and authority

- TAPD workflow status is the sole business status. Do not add local completion, reopening, blocked, phase or exited task states. A cached status is a dated snapshot, not another authority. Unknown status, stale data and pending ownership confirmation are data-quality or relationship indicators.
- Scope item identity by Paseo host, configured TAPD connection, actual TAPD project, kind and ID. Scope a board by host and Agent conversation. Uniqueness is enforced by the owning daemon; this specification does not claim global exclusivity across independently operated hosts.
- The responsible Agent is a plugin association, distinct from TAPD owner/current-owner people. A single item has at most one confirmed responsible Agent. Other Agents may view or assist; independent deliverables use separate real child items.
- Formal task membership comes from confirmed responsibility. References, ordinary reads, links, successful comments and historical result cards do not grant ownership. Creating an item also does not silently assign it unless the user's instruction includes taking responsibility or dispatching it.
- All assignment paths, including existing binding tools, UI binding, dispatch and imported settings, must pass the same validation. Remove permissive paths that would recreate multiple owners or resurrect exited/deleted associations.

### Acceptance, transfer and release

- Add schema-validated board query and responsibility operations at the existing tool/RPC boundary. Default mutation subject is the calling Agent. Reads may name a different accessible Agent but confer no additional write rights.
- A delegation message is a proposal, not a silent assignment. The target Agent accepts through the normal take-responsibility action. Do not build a separate inbox for new delegation requests. Keep legacy migration confirmation distinct from such an inbox.
- A user may authorize direct assignment or transfer. An original owner may initiate a handover, but the target must accept before ownership changes. Merely passing another Agent's ID or setting a confirmation flag does not establish delegated authority; preserve caller identity and validate the operation's authorization context.
- Acceptance checks configured connection/project, the actual item and target Agent existence. Repeated self-acceptance is a no-op; another existing owner or unresolved legacy conflict yields an explicit conflict identifying the current association. Archived boards remain reserved until explicit transfer or release; archiving itself must not free ownership.
- Serialize ownership validation and durable changes together, so two competing requests cannot both succeed. Transfer removes the old owner and assigns the new owner as one atomic relationship update, with an expected-owner/revision check. Acceptance recorded against a deleted Agent must not survive reconciliation.
- Exiting removes the caller's responsibility and board membership, records a reason, and leaves TAPD untouched. It does not create an exited task status or completed count. Transfer/exit must also suppress equivalent legacy associations so settings refresh cannot restore them.
- Keep actor, time, reason and affected relationship in local operation history. Do not post automatic business comments for relationship housekeeping. Explicit stage or acceptance feedback continues through existing authorized comment tools.
- Direct assignment is silent. Existing explicit dispatch remains a separately approved execution path: validate or reserve ownership before creating resources, recheck before committing responsibility, and do not send a prompt until binding is successful. Failures must report any created workspace/Agent and prompt uncertainty. Keep recoverable resources; never automatically dispatch or send again.

### TAPD hierarchy and actual status

- Reuse existing item, project-specific workflow/status, child-task creation and detail capabilities. Add schema-validated child-requirement creation and child-requirement reading, using the actual parent project and permitted requirement categories.
- Support real tasks and child requirements as the work-splitting primitives. Preserve existing associated-bug detail behavior; do not turn existing related bugs into synthetic child requirements.
- Parent queries/UI show actual related children with their real status and responsible Agent. Read-only child expansion does not take responsibility, create cards on other Agents' boards, or make a parent Agent owner of a child.
- Bound list sizes, report pagination/partial failures/truncation, and do not infer parent completion from child counts. Do not automatically write any parent/child state or enable automatic child closure. Follow actual TAPD workflow behavior and present any resulting changes on refresh.
- Keep the existing status-change tool for completion and reopening, project-specific candidates and authorization checks. Read current state after mutation before presenting the board as up to date; a successful write followed by failed verification remains accepted/unverified, not a failed write to retry.
- Classify by reliable project/kind workflow completion metadata or verified built-in semantics. A label alone or ambiguous display text is insufficient. Where terminal metadata is inaccessible or a workflow cannot be interpreted, retain a status-uncertain entry outside definitive counts.

### UI and refresh

- Retain the composer entry and reusable detail tabs. The main surface becomes the task board with unfinished/completed tabs and counts, defaulting to unfinished. Provide recent-viewing and migration-confirmation secondary entrances. Keep an accessible way to reach the board with no formal tasks when references or migration items exist.
- Maintain compact title typography, responsive one/two-column cards based on the actual container, semantic status colors, visible focus and keyboard actions. Show title, actual TAPD status and responsible Agent. Parent cards can expand child items with assignment information.
- Reuse complete detail operations, image/body rendering and draft protection. Keep linked Agent work above the description. Assigned items hide duplicate bind/dispatch actions; users use an explicit transfer/release action where authorized.
- Sidebars and Agent queries share the same board definition, ownership store, classification and completeness rules. They need not share an in-flight snapshot, but must expose freshness/partiality so different timestamps are not mistaken for contradictory responsibilities.
- Opening fetches fresh summaries/status; allow manual refresh and refresh every 30 seconds only while the board is visible. Stop timers on hide/unmount; prevent overlapping refresh waves. A current successful tool status mutation invalidates the relevant board immediately. Opening details still fetches full content on demand.
- Preserve last-known items on failure, mark them stale with last-success information and safe retry controls. Never delete responsibility due to an item/status read failure. Unknown/deleted/inaccessible TAPD responses must remain distinguishable from proof that an Agent conversation was deleted.

### Persistence, migration and lifecycle

- Extend existing local plugin persistence and recovery patterns; do not put bodies, comments or credentials in board or operation-history records. Do not add ownership/history to Git settings sync. Publish only credential-free summaries to the UI and calling provider.
- Migrate existing tool and legacy settings bindings idempotently. Preserve candidates and origins. All historical bindings need explicit acceptance/confirmation before formal task membership. Multiple different Agent candidates are an unresolved ownership conflict until the user chooses one; do not pick by recent activity.
- A confirmed user's choice resolves the candidate set into one owner and prevents rejected legacy candidates from reappearing. Repeated imports/reloads do not duplicate records or silently bypass this decision.
- Historical references remain under recent viewing, with existing conversation/provider isolation and historical result cards preserved. Migration does not rewrite TAPD or reinterpret old tool success as acceptance.
- Closing windows/conversations and daemon restart preserve boards. Archiving retains associations/history; restoration restores access. Deleting the owning Agent conversation cleans its board, responsibility and owned local history, without TAPD writes or deletion of other Agents' work.
- Other existing parent/child views resolve the item as unassigned after owner deletion, not completed. Deletion reconciliation requires an authoritative lifecycle result; timeout, permission failure or disconnected host is not evidence of deletion. Recovery must reconcile deletion before presenting a new owner.
- Corrupt storage or migration failure yields a useful recoverable error; do not replace unreadable data with an empty store or mass-release ownership. Preserve atomic file update and existing secret-sanitization guarantees.

### Read-only card labels (user-confirmed implementation amendment)

- Fetch real label data with existing summary/detail reads rather than one extra label call per card. Show at most two compact labels and +N on cards, with safe truncation of long names; full detail shows all available labels.
- Reuse display in shared result cards when payload labels are available, without retroactively fetching or rewriting historical cards. Confirmed empty labels consume no empty row; unavailable/missing label values are identified as unknown, not cleared.
- Display does not create an editor, infer completion, take responsibility or write labels. Next fresh reads after label edits must show current labels. Keep responsive geometry and existing child/refresh behavior.
- This addition was explicitly confirmed during implementation and is tracked by the supplemental child ticket; final integration acceptance includes it.

### Generic label tools

- Expose project-label list, project-label creation, item-label read, and incremental item-label add/remove through schema-validated Agent tools. Support story, task and bug where actual deployment permits; return precise capability/permission failures for unsupported operations.
- Keep vocabulary generic. Do not hardcode Matt categories, triage roles, namespaces, exclusivity groups, transitions or lifecycle-triggered label mutations. Skill authors/callers select labels under normal authorization.
- Validate actual project/item, string lengths/counts and label separator restrictions. Preserve names and existing labels rather than guessing case-insensitive equivalence. Distinguish absent/unreadable label data from a confirmed empty set. Pagination and truncation of project labels must be explicit.
- Adding an existing label or removing an absent label reports unchanged without POST. Add/remove affect only requested names. Creating a project label and attaching it to an item are different operations; explain when attachment may create an unknown label in TAPD.
- Write only the target label field, not other item properties. If the deployment exposes only whole-set replacement, read fresh, compare the expected set, merge the requested delta and recheck before writing. Serialize plugin-originated updates to the same item. This cannot prevent external edits in the final read/write window; report the limitation and never claim atomic CAS.
- Verify add/remove by fresh read-back, including preservation of unrelated labels. Test removing the last label explicitly. If clearing semantics or returned labels are unsupported/ambiguous, report unsupported/not-sent or accepted/unverified as appropriate; do not silently claim success or use an undocumented destructive fallback.
- Require specific target/action authorization for project-label creation and item-label changes. Existing approved scope may be reused. Calling a skill, reading a label, refreshing a board or recovering storage is not write authorization.
- Retain safe distinctions between not-sent, rejected, accepted/verified, accepted/unverified and unknown. No automatic write retry on timeout, cancellation after dispatch or presentation/persistence failure. Follow up with fresh read-only verification.

### Delivery and documentation

- Update user documentation, plugin overview, manifest, tool descriptions and the plugin workflow skill together when implementing. Keep the documented supported Paseo beta/main SDK contract accurate, and use the committed matching SDK lockfile.
- Implement through fork issues and integration PRs after ticket decomposition. Spec publication does not itself authorize production TAPD writes, daemon upgrades, external Agent messages or migration of the running installation.

## Testing Decisions

The user confirmed three public behavior boundaries. Prefer existing tool execution, validated RPC, actual React Native Web interaction, and isolated real-daemon recovery harnesses. Avoid tests of private helper structure or assertions that merely copy implementation.

1. **Tools and data boundary:** exercise registered tools/RPCs with controlled TAPD responses and real local persistence. Verify self/default identity, named-board reads, wrong-project/host isolation, no take-on-read, one winner for concurrent acceptance, idempotent self-acceptance, transfer authorization/expected-owner conflict, exit, legacy confirmation, multi-binding conflict and deletion reconciliation. Test existing binding/dispatch/UI paths against the same invariant, including partial created resources and prompt uncertainty.
2. **TAPD integration behavior at that same boundary:** cover actual parent project, child-task and child-requirement semantics, allowed requirement types, incomplete child pagination, project-specific terminal metadata, custom/parallel/unknown workflows, accepted writes with failed read-back, label list pagination, generic label names, duplicates, delta preservation, missing versus empty, last-label removal, denied permissions, pre-write conflicts, external concurrent edits and unknown outcomes. Assert no unrelated field writes and no automatic retry. Use documented fixture contracts; report deployment limitations separately.
3. **User interaction boundary:** use existing full detail/conversation UI harnesses to verify board tabs/counts, recent viewing versus formal membership, migration selection, uncertain/stale rows, responsive geometry, keyboard/focus, accessible actions, parent expansion and reusable detail operations. Verify shared semantics with tool outputs, 30-second visible-only refresh, manual retry, no overlapping waves and immediate invalidation after a confirmed write.
4. **Recovery acceptance across the existing public boundary:** run isolated real daemon subprocesses with synthetic providers/TAPD, a disposable home and stable loopback API. Restart and reload; restore confirmed ownership, candidates and views; preserve archive; reconcile deletion; prove no recovered writes, message sends, implicit label changes or duplicate dispatch. Include storage failure and retain-data-on-error behavior. This is an acceptance run, not a new production API.
5. **Validation discipline:** use controlled fixtures first. Real deployment writes require later explicit target/payload authorization and are not a prerequisite silently satisfied by this spec. Check real beta/main host compatibility, typecheck and lint. Browser geometry assertions do not substitute for a claimed human visual review; no new screenshots are captured/generated by the Agent.

## Out of Scope

- A second local task-state machine, virtual stage tasks, automatic completion at turn end or automatic parent completion.
- Multiple confirmed primary Agents for the same scoped item; global cross-host ownership coordination.
- A new delegation inbox, a general chat/message service, or automatic execution on direct assignment.
- Automatic comments or label changes because a skill ran, a board opened, or an Agent became idle.
- Matt-specific label vocabulary, role transitions, label-based authorization or labels replacing ownership checks.
- Project-wide label deletion/renaming/color administration, bulk destructive label replacement, or a general-purpose all-fields editor.
- A new label-management UI; the requested addition is generic Agent tools. Existing label filters remain available.
- Automatic creation of all possible project categories or silent fallback from unsupported child requirements to unrelated items.
- Atomic TAPD transactions/CAS or exactly-once guarantees where the remote API does not provide them.
- Production business writes, host upgrades, registry publication or runtime migration as part of writing this specification.

## Further Notes

This specification incorporates the final confirmed model. It supersedes the earlier suggestion of independent Agent completion states, per-Agent virtual work stages on the same item, and virtual coordinating/executing tasks. Existing software still uses reference lists and multi-binding records until implementation and migration are delivered.

Technical sources checked during specification:

- [TAPD project-label query](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/label/query_label.html) and [label creation](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/label/add_label.html) document project-scoped lists and label definitions.
- [Story updates](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/story/update_story.html), [task updates](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/task/update_task.html) and [bug updates](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/bug/update_bug.html) each document an item label field and separator-based multiple names. These contracts establish intended support, not actual deployment permissions or reliable empty-set clearing.
- [Story creation](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/story/add_story.html) documents a parent requirement parameter; [requirement types](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/story/get_workitem_types.html) document allowed child/parent types. Project configuration and the target deployment must be checked before writing.

Known implementation gaps: shared item detail currently reads child tasks/bugs but not child requirements; generic creation excludes parent requirement assignment; ownership currently keys by Agent as well as item and so does not enforce item-level exclusivity; conversation references and assignment records have separate lifecycle handling; label filtering exists without generic label-edit tools. Implementation must address these gaps rather than infer that existing interfaces already satisfy the design.

No implementation, runtime reload, data migration or real TAPD mutation was performed to produce this specification.
