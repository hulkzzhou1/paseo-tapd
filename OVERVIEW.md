# TAPD Workbench: capabilities and data flow

## Current scope

The plugin provides a TAPD workbench, complete item details, prompt attachments, direct Agent tools and explicitly approved dispatch to a new Agent. It requires the public SDK available in compatible Paseo 0.14.0-beta.1+ builds. Client UI and daemon handlers communicate through schema-validated RPCs.

There are no conversation result cards, composer TAPD shortcuts, session task panels, recent-viewing lists, local responsibility/claim/delegation/transfer records, task history or task classification. The only timeline contribution hides this plugin's two retired result-card kinds; other plugin items and normal messages remain unchanged. No timeline items are appended or rewritten. No Agent lifecycle events are observed and no startup reconciliation runs.

Workflow status belongs to TAPD. Workbench completion filtering reads each project's `/workflows/last_steps`; unavailable workflow metadata falls back to standard terminal keys/explicit completion labels, which may not recognize custom terminal labels. Agent completion never changes TAPD status or posts comments automatically. The legacy automatic-feedback setting is ignored.

## Workbench and detail

The default aggregate view shows requirements, tasks and defects without status grouping. Grouping is optional; single-type views hide empty columns by default while retaining explicit column selection. Filters include workflow status scope, iteration, modification time, creator/owner, priority, severity, labels and supported field conditions. Saved views, favorites and field-layout preferences use plugin settings.

Details show current properties, labels, structured description, parent/child relationships and the latest 30 comments. Requirement child lists have bounded reads/pagination and explicit partial/truncated/unknown totals. Child status does not determine parent completion. Requirement custom definitions come from the actual project/category; six nonempty short fields are initially visible, with expansion and empty-value control. Missing, unknown, unsupported and failed values are distinguished from confirmed empty. Rich-text tabs follow field-definition order and read only the selected document. Detail actions preserve opening-only reading positions; new/comment drafts require discard confirmation. Custom fields are readonly in the UI; supported text/rich-text edits remain available through authorized tools.

Rich text is parsed into safe reading structures: headings, paragraphs, lists, code, links and horizontally scrollable tables. Remote scripts/styles and unsafe URL schemes are ignored. Description/comment bodies are not silently truncated to older presentation limits, but upstream read limits still apply. Images display inline with aspect-ratio bounds, retry and original-link controls.

Workbench snapshots use bounded in-memory stale-while-revalidate caching (90 seconds); API responses use finite-capacity caches (typically 20 seconds, metadata up to 30 minutes). Fresh item/field/iteration/label reads bypass stale responses, and settings changes invalidate caches and old in-flight results. Manual refresh bypasses cached workbench snapshots; stale snapshots trigger short-lived refresh polling. Optional workbench auto-refresh is clamped to 30–3600 seconds. Direct Agent tools generate no client cards/invalidation poller: manually refresh visible views or use the configured refresh interval to see later tool changes.

## Writes and dispatch

Business writes require an explicit user action/authorization and validated input. Existing item writes freshly verify identity, entity kind and actual configured project before POST; invalid or inaccessible targets stop rather than guessing. Standalone creation may default to the first configured project. TAPD content is untrusted data and cannot authorize writes.

- Creation loads required fields/category metadata. Child creation uses explicit verified parent/category relationships and returns accepted-unverified if readback cannot establish them.
- Status/comment writes use the actual target project. Defects use item-specific reachable workflow transitions, expected current status and approved transition fields; required remarks are part of the transition, not a separate comment.
- Requirement text/rich-text updates use actual writable field metadata and the exact raw expected value; readonly/unknown permissions, unsupported types and conflicts stop.
- Iteration updates verify one requirement/task/defect and an existing nonzero iteration in the same project, recheck the exact old raw value and POST only identity/iteration fields. Clearing/creation/bulk or parent-child propagation are excluded.
- Label tools expose project definitions and generic item add/remove operations, preserving unrelated labels. Duplicate-definition checks and expected-value comparisons are bounded and are not remote atomic locks. Last-label clearing is excluded until deployment semantics are established. Labels do not create a plugin workflow or skill state.

All operations distinguish rejected, unknown and accepted-unverified results; success after TAPD acceptance cannot become a request to replay a write because of cancellation or result serialization. No write is automatically retried. Query to reconcile uncertain outcomes; the latest-30-comment limit means absence from that read is not proof a comment was never posted.

**Dispatch remains available** in details and via `tapd_dispatch_agent`. The user approves the exact item/project, Git repository, selectable provider/model, branch and prompt. The server freshly verifies the item and checks the repository/model against Paseo's public catalog, rejects credential-bearing payloads, then creates a worktree workspace and Agent through the public SDK and sends the approved prompt once. The client may navigate to that Agent. This starts provider execution and may incur its cost; it is separate from TAPD mutation authorization.

Dispatch stores no plugin binding, responsible Agent or local task state, changes no TAPD fields and claims no exclusivity. The plugin does not prevent two explicitly requested dispatches for the same item. Failure retains created resources, returns known workspace/Agent IDs, the phase and prompt certainty, and never deletes resources or resends automatically. An uncertain workspace/Agent creation may have no returned ID; inspect Paseo resources before retrying. The form prevents repeat submission after an attempt. Repository/model listing errors and dispatch errors omit raw responses.

## Settings and persistence

Credentials and project IDs come from settings, falling back to daemon `TAPD_TOKEN`/`TAPD_WORKSPACE_IDS`. API and webpage addresses come from settings, environment `TAPD_API_ENDPOINT`/`TAPD_SITE_URL`, or defaults `https://api.tapd.cn`/`https://www.tapd.cn`. Addresses accept HTTP(S), without embedded credentials, query or fragments. Settings tokens are plain local JSON readable by connected settings users. No credentials are printed, sent in prompts/tool output or committed. Existing launch environment variables are preserved when the session-open hook supplies missing TAPD connection variables and direct tools.

Connection, views, favorites and layouts remain local. Old Agent links/automatic-feedback fields remain readable only for saved-settings compatibility and are unused; saved repository/model defaults can prefill dispatch. `PASEO_HOME/plugin-data/tapd-workbench/agent-links.json` and `conversations.json` remain untouched: no read, migration, write or deletion. In-memory read caches are not a second task store. No full body, comment, image or tool-result persistence is introduced by the plugin; normal tool output and explicitly dispatched prompts follow the host/provider's own retention rules.

Git backup/restore is removed; the plugin does not clone, push or access old backups. Creating an explicitly approved worktree through Paseo remains supported. Removed RPC/tool names return unavailable; old Agents may retain obsolete schemas until the host reopens their session. The bundled skill instructs Agents to use direct tools and TAPD-native state; skill discovery is provider-managed, not automatic injection.

## Network destinations

1. **Configured TAPD API**: authenticated HTTP(S) requests for identity, projects/items, field/workflow/category metadata, iteration, members, comments, label definitions and approved writes. Token goes only to the configured API; API redirects are rejected. Errors are sanitized and values/schema/limits validated. No business endpoint is guessed after a permission/read failure.
2. **TAPD image download destination**: for site-local `/tfl/captures/` or `/tfl/pictures/` PNG/JPEG/GIF/BMP paths, the daemon uses the actual configured item project with `/files/get_image`. The trusted API returns an HTTP(S) download URL; subsequent download/redirect hosts receive no configured Authorization or cookies. RPC callers supply only validated paths, not arbitrary URLs. Image signatures and an 8 MiB bound are verified before returning inline base64. Nothing is written to disk; unused client image queries expire after 60 seconds.
3. **Other safe content HTTP(S) URLs**: inline images load in the client without configured TAPD credentials (normal browser cookies may apply); other links open on explicit click. The web domain resolves item and relative-content links, not API authentication.
4. **Public GitHub registry**: workbench update checks query `api.github.com`, falling back to `raw.githubusercontent.com`, for the public registry record and pinned manifest/version. No user data or TAPD credentials are attached. Results are cached for one hour. Updates remain manual.
5. **Selected Agent provider and Git source through Paseo**: approved dispatch asks the host to create a worktree and start a provider with the displayed, editable item snapshot/prompt. Host/provider integrations determine their existing network destinations. No hidden prompts or Agent messages occur on reads, reload or restoration.

There is no telemetry, remote-code execution/eval, shell built from external data, configuration Git remote or background Agent scan. The plugin is trusted and unsandboxed by design.

## Validation and limits

Tests use real registered tools/RPCs with synthetic HTTP, and actual components calling a real isolated daemon for workflow, properties, documents and iteration updates. Retirement coverage verifies registration removal, no lifecycle/host calls on reads, byte-preserved old stores, no new timeline cards, scoped old-card hiding, full details and manual refresh. Dispatch coverage checks approved success, rejected inputs, partial resources and prompt uncertainty; no production provider execution is part of acceptance.

Readonly current values can change after a read. Pre-write comparisons are not remote atomic locks. Workbench columns cap at 300 items; child lists and queries disclose their own bounds. Production TAPD write permissions and deployment-specific iteration/label-clear compatibility remain unverified. Native-device and human visual review are separate from browser tests. The existing author-provided screenshots are historical and unchanged; agents must not capture or generate replacement media.
