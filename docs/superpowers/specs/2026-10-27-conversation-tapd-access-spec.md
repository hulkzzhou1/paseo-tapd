# 对话中的 TAPD 快捷触达 — 实施规格

## Problem Statement

Agent 已能通过工具查询、创建和操作 TAPD 单据，但用户仍需要寻找结果中的链接、切换工作台或向上翻阅对话才能再次打开单据。对话中的普通 TAPD 链接也缺少与工作台一致的快捷访问路径。

用户希望在当前 Agent 对话中快速触达明确涉及的单据，直接打开完整详情及操作页，并让这些入口跟随对话保留；批量查询不能把会话入口变成庞大的结果全集。

## Solution

采用“会话单据入口 + 工具结果卡片”。

- 输入框上方显示 TAPD 入口和会话单据数量。没有单据时隐藏；只有一张时点击直达详情；多张时展开紧凑列表，再点击打开详情。
- 单张查询、成功的建单/评论/状态操作，以及用户和 Agent 普通消息中的明确 TAPD 链接，收录到当前会话。批量查询先保留为结果列表，点击某张后才加入会话入口。
- 未读取过的链接先显示编号，点击后才读取 TAPD 详情；已有工具结果的短摘要直接复用。
- 工具单张结果以紧凑卡片显示；批量结果默认显示前 5 条，可展开其余已返回结果，保留失败和截断提示。
- 从任一入口打开完整的现有详情及操作页，关闭后继续原对话。卡片保留操作当时的摘要，详情读取当前数据。
- 会话单据和结果卡片随所属 Agent 对话的生命周期保留：关闭、重开、插件重载和 daemon 重启后恢复；归档保留，恢复后可用；删除会话时清理，不另设到期时间。

## User Stories

1. As a TAPD user, I want a successfully queried single item added to the conversation, so that I can reopen it without repeating the query.
2. As a TAPD user, I want a newly created item shown as a result card, so that I can inspect the item I just created.
3. As a TAPD user, I want a status update result to identify its target item, so that I can inspect the updated item immediately.
4. As a TAPD user, I want a comment result to identify its target item, so that I can return to the relevant discussion.
5. As a conversation participant, I want my explicit TAPD links collected, so that pasted items remain easy to find.
6. As a conversation participant, I want explicit TAPD links in agent replies collected, so that suggested items remain accessible.
7. As a TAPD user, I want unfamiliar links initially shown by item number, so that message scanning does not automatically retrieve TAPD content.
8. As a TAPD user, I want existing result summaries reused, so that known titles and statuses appear without redundant requests.
9. As a TAPD user, I want bulk results kept outside the focused conversation list until selected, so that a large query does not overwhelm my shortcuts.
10. As a TAPD user, I want opening a bulk result to add that item to the conversation list, so that I can revisit the item I actually inspected.
11. As a conversation participant, I want the TAPD shortcut hidden when empty, so that unrelated conversations keep their usual layout.
12. As a TAPD user, I want one collected item to open in one click, so that the common case stays fast.
13. As a TAPD user, I want multiple collected items shown in a compact list, so that I can choose the intended item.
14. As a TAPD user, I want recently mentioned or opened items first, so that the current topic is easy to find.
15. As a TAPD user, I want repeated references to the same item deduplicated, so that shortcuts remain concise.
16. As a TAPD user, I want to remove a conversation shortcut, so that I can keep the list relevant without deleting the TAPD item or old result cards.
17. As a TAPD user, I want removed shortcuts to stay removed when old history is reprocessed, so that reopening the conversation respects my choice.
18. As a TAPD user, I want a new explicit mention, item operation or deliberate open to collect a removed item again, so that it can become relevant later.
19. As a TAPD user, I want shortcuts restored when I reopen the same conversation, so that closing the window does not lose context.
20. As a TAPD user, I want shortcuts and result cards restored after plugin or daemon restart, so that conversation access does not depend on one running process.
21. As a TAPD user, I want tool results collected while no client is open, so that background agent work is available when I return.
22. As a TAPD user, I want archived conversation data retained, so that restoring that conversation also restores its TAPD context.
23. As a TAPD user, I want deleting a conversation to clear its local TAPD references and card records, so that their lifetime matches the conversation.
24. As a user of multiple hosts and conversations, I want each conversation to retain its own TAPD list, so that unrelated work does not mix.
25. As a user of multiple TAPD projects and item kinds, I want items identified in the correct context, so that similar numbers do not open the wrong item.
26. As a TAPD user, I want complete structured descriptions, inline images, comments and related items in the popup, so that conversation access provides the same reading experience as the workbench.
27. As a TAPD user, I want existing comment, status, child creation, dispatch and agent binding actions available, so that I can continue working from the conversation.
28. As a TAPD user, I want existing confirmation and unsaved-input protection retained, so that using a new entry point does not lose drafts or bypass write rules.
29. As a conversation participant, I want closing the popup to return to my original conversation and position, so that inspecting an item does not interrupt discussion.
30. As a TAPD user, I want historical result summaries distinguished from current detail, so that an old card does not imply its status is current.
31. As a TAPD user, I want failed detail reads to retain a recognizable reference and offer retry, so that a temporary failure does not erase context or invent item data.
32. As a TAPD user, I want bulk results to show five items initially and expand the remaining returned items, so that the conversation stays readable.
33. As a TAPD user, I want partial failures and truncation clearly identified, so that I do not mistake a limited result for an exhaustive project list.
34. As a keyboard or mobile user, I want accessible controls and compact layouts across themes, so that the shortcut works like the rest of Paseo.
35. As a TAPD user, I want successful writes to remain successful even if card recording or rendering fails, so that I am not prompted to create duplicate items or comments.
36. As a TAPD user, I want history restoration to restore presentation only, so that reconnecting or restarting never repeats a TAPD write.
37. As a TAPD user, I want persisted conversation data limited to references and short summaries, so that descriptions, comment bodies and credentials are not copied into a new store.
38. As a TAPD user, I want conversation shortcuts separated from favorites and agent assignments, so that merely discussing an item does not change those relationships.
39. As a conversation participant, I want ordinary messages and links to retain their existing behavior, so that TAPD access does not replace message rendering or text interactions.
40. As a TAPD user, I want unsupported or inaccessible references handled explicitly, so that the plugin never reads an unconfigured project or silently opens an item through a different connection.

## Implementation Decisions

1. Use the installed Paseo mainline SDK and its public agent tool, timeline, composer-button and RPC interfaces. Keep runtime boundaries intact and validate cross-process payloads with schemas. Do not use unpublished host internals to intercept message links or modify settings.
2. Introduce conversation-scoped references and result records. A reference retains the owning host and agent context, TAPD project, item kind and item number, plus only available short display metadata. Conversation collection is distinct from item-to-agent assignment and global favorites.
3. Treat focused collection and bulk result presentation as separate concerns. Explicit single-item tools and successful writes collect their target. Search and board results produce batch result records, including existing total/partial/truncation information; they do not automatically collect every returned item. Selecting a batch item collects it and opens detail.
4. Observe ordinary user and assistant messages through public timeline reading/subscription. Parse only explicit item URLs belonging to the configured TAPD site and configured projects, validate their structure, and preserve original text. Do not treat arbitrary numbers, fuzzy titles, embedded business instructions or raw batch tool output as collection events.
5. Do not call TAPD merely to scan or collect a link. Show an item-number placeholder when metadata is unknown. Reuse metadata already obtained by tools. Detail loading remains explicit on open and must use current authorized configuration; an old reference incompatible with the current connection cannot silently be remapped.
6. Keep references deduplicated and ordered by their latest genuine mention or deliberate open. Retain removal information and source progress so history replay, streaming updates and reconnects cannot undo removal or duplicate cards. A new source event or deliberate user selection may collect the item again; reprocessing the same source is not a new mention.
7. Persist conversation references, compact result records and replay/removal information independently of existing Git-synced settings. Current mainline plugin timeline rows alone cannot guarantee daemon-restart recovery, and public server settings access does not provide save. Use plugin-owned local persistence with schema validation, serialized updates and atomic replacement; do not modify Paseo's internal settings files. Do not persist full descriptions, comment bodies, tokens, cookies or authenticated download URLs.
8. Restore stored records and runtime registrations without executing original tools or repeating writes. Cover disconnected clients and background tool execution. Preserve archive data, and clean up only when the owning conversation is actually deleted; absence from a filtered/paged list, disconnection or archive is not proof of deletion. Restore old history completely enough to meet the feature rather than scanning only a fixed tail of messages.
9. Use the composer entry for focused navigation. Zero references hides it, one opens detail immediately, and multiple references open a compact recent-first list with remove actions. Close the list before opening the detail popup; preserve the user's conversation context.
10. Render schema-validated result cards. Single-item cards identify the item and operation outcome; batch cards start with five results and expand or page through the rest already returned. Retain failure and truncation indicators. Keep timeline payloads within host limits by using bounded summaries/references and loading additional recorded pages as needed; do not silently omit returned items or call a truncated batch complete.
11. Share the existing detail and operation experience with the workbench, including description/image reading, related-item navigation, current status, comment, child creation, dispatch, binding, agent association display and draft protection. Reuse existing services and confirmations rather than maintaining a separate detail implementation. Opening a stored reference must not be blocked by an unrelated workbench filter.
12. Separate TAPD mutation outcome from reference persistence, timeline append and card rendering. Once a write succeeds, later presentation failures must not change its success outcome or trigger an automatic write retry. Report a recoverable presentation/storage warning where appropriate without exposing raw payloads or secrets. Failed or ambiguous writes must not produce a success card.
13. Use current theme tokens, keyboard-accessible controls, focus restoration and compact layouts. Release subscriptions and button registrations on teardown; manage archived and deleted agents without subscribing indefinitely to inactive conversations. Current composer registration requires a workspace; verify the supported agent context during implementation and retain result-card access where no composer registration is supported.
14. Preserve existing credentials, project isolation, API destinations, network authentication rules and settings. The new durable flow is local storage of conversation references and short summaries; document its lifetime and cleanup in the user-facing capability/data-flow documents. Link collection adds no external network destination. Release metadata and version updates accompany the eventual implementation, not this specification-only change.

## Testing Decisions

Test observable behavior at the highest existing public seams; avoid implementation-mirroring tests for internal maps, callback ordering or storage layout.

1. **Tool and conversation-event boundary.** Extend the existing real tool-definition/entrypoint integration harness with fake TAPD responses and a controllable host timeline. Exercise focused versus batch collection, successful/failed/ambiguous writes, explicit URL parsing without extra TAPD reads, streaming/reconnect replay, deduplication, ordering, removals and new recollection. Include host/project/kind/agent isolation and configuration changes. Verify successful writes remain successful after an injected persistence or append failure.
2. **Card and composer-entry interaction boundary.** Extend the existing public React Native Web/browser interaction approach using fake host capabilities and actual plugin components. Exercise zero/one/multiple entries, list removal, cards, batch five-item expansion, partial/truncated states, click-to-load, detail errors/retry, complete shared detail/actions, return to chat, draft protection, keyboard/focus, themes and narrow screens. Verify no accidental requests or writes occur from rendering, link scanning or history restoration.
3. **Lifecycle acceptance through the same boundaries.** Use an isolated real daemon with mock TAPD data to verify client-offline collection, plugin reload, a real daemon restart, conversation reopen, archive/restore and actual deletion. Check reconstructed entry/card behavior and zero repeated writes; avoid restarting the user's active daemon as a substitute for this test. Validate recovery from an interrupted local save without accepting corrupted or cross-conversation records.
4. Preserve the prior agent-tool authentication, cancellation, byte-bound, secret-redaction and board-completeness coverage, and the workbench detail/form regression coverage. Assertions and fixtures remain desensitized. Agents do not capture or generate screenshots/media; use existing read-only assets where needed.
5. Run typecheck and lint, relevant Node integration tests and browser interaction checks against the matching installed mainline SDK. Test writes only against mocks. Verify the live installed plugin with read-only access while preserving the current connection and user settings.

The user confirmed both public test boundaries and the separate real daemon-restart acceptance check. Product behavior and the testing approach are settled; this specification does not reopen the design interview.

## Out of Scope

- Global favorites, automatic item-to-agent binding or dispatch merely because an item is discussed.
- Adding every item from a bulk query to the focused conversation list.
- Guessing item identity from arbitrary numbers or natural-language titles.
- Replacing whole ordinary messages or globally intercepting native Markdown link clicks.
- Automatically fetching TAPD summaries or full content when an unknown link appears.
- New TAPD write abilities, changed write confirmations, automatic write retry or replay.
- Persisting descriptions, comment bodies, credentials or image bytes, or exporting conversation records through Git sync.
- Time-based expiration independent of the owning conversation, or promotion to a global cross-conversation list.
- Upstream Paseo SDK changes, public registry publication, screenshots or image generation as part of this spec task.

## Further Notes

- This specification synthesizes all nine confirmed choices and the explicit instruction to follow the Agent conversation lifecycle. It is not an implementation claim.
- The existing fork's main branch is the future integration target; implementation tickets must reference this specification and close through their integration PR. No implementation ticket breakdown or feature PR is created by this specification step.
- Mainline compatibility was inspected at Paseo commit `6b7d49f0d8d21d01565f9517a8c2a30e2a587e2a`. Recheck the installed SDK when implementing; do not substitute the npm SDK merely because the version number matches.
- The earlier design note and glossary preserve the interview decisions. No consequential irreversible architectural trade-off has been finalized that requires a separate ADR.
- No feature code, real TAPD mutation, screenshot capture or daemon restart was performed while preparing this specification.
