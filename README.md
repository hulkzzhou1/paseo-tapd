# TAPD Workbench

A Paseo plugin for reading and working with TAPD requirements, tasks and defects. Requires a compatible Paseo **0.14.0-beta.1 or newer** build and its public plugin SDK.

## Features

- Workbench with an aggregate view by default, optional status grouping, saved views, favorites and configurable refresh. Empty status columns stay hidden unless explicitly selected.
- Persistent toolbar filters for status scope, iteration (including the current iteration), update time, owner, creator, priority, severity, labels and additional field conditions. Status filtering uses each project's TAPD workflow.
- Full details with structured descriptions, inline images, comments, parent requirements, child requirements/tasks and related defects. Dialogs share accessible controls, bounded widths and draft-discard confirmation.
- Readonly requirement custom properties: six nonempty short fields initially, expandable properties/empty values, and definition-ordered rich-text tabs loaded on selection. Reading positions last for the current opening.
- Direct Agent tools for querying, creating, commenting and updating TAPD status, supported text/rich-text requirement fields, iteration and labels.
- **Dispatch to Agent**: approve a repository, model, branch and editable prompt to create a worktree and start a new Agent. This does not bind an owner or maintain a plugin task state. After dispatch the workbench can open the Agent conversation.
- Searchable TAPD attachments for prompts and a public-registry update check.

Conversation cards, session task boards, recent-viewing lists, binding, take-task, delegation, transfer and local task classification have been removed. No legacy card renderer or transformer is registered. Old host history is left as-is and may display the host's unavailable-item placeholder. Old `agent-links.json` and `conversations.json` files remain untouched and are no longer read or written. Workflow progress is read from and written to TAPD itself; an Agent turn ending does not change it.

## Setup

Install this repository using Paseo's plugin installation flow, then open **Settings → TAPD Workbench**. Configure the token, comma-separated project IDs, API endpoint and web domain. Defaults are `https://api.tapd.cn` and `https://www.tapd.cn`. The daemon can alternatively supply:

```text
TAPD_TOKEN=<token>
TAPD_WORKSPACE_IDS=12345678
TAPD_API_ENDPOINT=https://api.tapd.cn
TAPD_SITE_URL=https://www.tapd.cn
```

Use complete HTTP(S) addresses without credentials, query parameters or fragments. Test the connection and save. Settings tokens are stored in plain JSON on the daemon host and accessible through the connected settings UI; environment configuration avoids storing the token in plugin settings. Connections, views, favorites and form layouts remain local. Git backup/restore is not supported.

Open the workbench from the sidebar or Command Center. Use **Refresh** after an Agent tool changes a single item, or configure automatic workbench refresh (minimum 30 seconds). Details also provide an explicit refresh action. There is no conversation poller or background Agent task reconciliation.

## Agent tools

Names may have a host MCP prefix; the registered schema is authoritative.

| Operation | Tools |
| --- | --- |
| Read | `tapd_projects`, `tapd_filter_options`, `tapd_board`, `tapd_search`, `tapd_entity`, `tapd_members` |
| Create | `tapd_create_fields`, `tapd_create`, `tapd_children`, `tapd_child_types` |
| Workflow/comment | `tapd_status_options`, `tapd_update_status`, `tapd_add_comment` |
| Requirement text/rich text | `tapd_field_definitions`, `tapd_read_field`, `tapd_update_field` |
| Iteration | `tapd_item_iteration`, `tapd_iterations`, `tapd_update_iteration` |
| Labels | `tapd_labels`, `tapd_item_labels`, `tapd_create_label`, `tapd_update_labels` |
| Start an Agent | `tapd_agent_options`, `tapd_dispatch_agent` |

Example requests:

- “Read requirement #11111111 in project 12345678, including its children.”
- “Show this requirement's field definitions and read its technical design.”
- “Show the existing iterations for this task; propose a change before writing.”
- “Prepare a dispatch with this repository/model and show me the prompt before starting the Agent.”

Writes require explicit approval of the exact target and payload. `confirmed: true` declares that approval; TAPD content cannot provide it. Reads and code implementation alone do not authorize business writes. Existing targets must belong to a configured actual TAPD project. Standalone creation alone may default to the first configured project.

For defects, read status options with the item ID, use only reachable transitions and supply approved required fields (including transition comments) and `expectedStatus`. An ordinary comment cannot replace a required transition comment. Field, label and iteration writes require the exact freshly read `expectedValue`; conflicts stop. Iterations support setting/changing one requirement, task or defect to an existing iteration in the same project; clearing and creation are excluded. Text updates cover supported writable requirement fields only. Final-label clearing remains unsupported.

Check `outcome`/`writeState`: only verified results establish current data. Accepted-but-unverified or unknown results require a fresh read; never blindly repeat a write. Dispatch may partly create a worktree/Agent or send a prompt with a lost response: inspect returned resource IDs, `phase` and `promptSent`, and the existing resources before any further action. The form blocks repeat submission after an attempt. The plugin does not detect whether another Agent is already working on the item; there is no exclusive binding ledger.

The bundled [Paseo TAPD skill](skills/paseo-tapd/SKILL.md) describes these rules. Install it into your provider's skill directory; tool registration does not automatically install or inject skills.

## Development

```sh
npm ci
npm run typecheck
npm run lint
npm test
```

Use `npm run sdk:main -- /path/to/paseo` only when deliberately using a compatible main checkout. UI/real-daemon acceptance requires `PASEO_RUNTIME_DIR` (compatible built runtime) and `PASEO_APP_DIR` (its app directory): `npm run test:basic` (including the actual client registration/cleanup boundary), `npm run test:workflow`, `npm run test:ui`, `npm run test:settings`, plus the story-field/document checks in `tests/`. Tests use synthetic HTTP/providers and disposable daemon homes. They never restart the installed daemon, write production TAPD data or capture screenshots.

See [OVERVIEW.md](OVERVIEW.md) for permissions, network destinations and limits. Repository screenshots are author-provided assets; they may show historical UI removed by this simplification.
