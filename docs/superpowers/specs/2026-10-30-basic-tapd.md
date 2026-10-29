# Basic TAPD scope (confirmed)

Supersedes the conversation/task-board/responsibility portions of earlier designs. Full custom-field reading, controlled iteration updates and existing direct TAPD safeguards remain in scope.

1. Remove conversation result cards, composer access, session task panels and recent viewing. Subsequent user clarification removes all legacy card renderers/transformers without compatibility handling; retain host history as-is.
2. Remove plugin responsibility, binding, take-task, delegation, acceptance, transfer, release, relationship history and classification. Do not register their RPCs/tools, scan Agent history, subscribe to lifecycle events or perform startup reconciliation.
3. Retain the workbench, filters/views/favorites, attachments, complete detail, comments, real TAPD hierarchy, readonly custom properties/document tabs, images and direct TAPD read/create/update tools. Status is TAPD-native; no implicit comments or transitions.
4. The user's subsequent clarification retains **dispatch to Agent** in details and tools: approve item/project, repository, model, branch and prompt; create worktree/Agent and send once. Do not create a local binding/ownership ledger or change TAPD. Return known resource IDs and safe partial/uncertain results, preserving created resources and blocking blind form resubmission. Dispatch does not guarantee exclusive execution.
5. Preserve existing connection/settings/views/favorites/layout. Stop reading/writing retired `agent-links.json` and `conversations.json`; leave their bytes intact. Legacy settings fields may remain ignored for compatibility. Repository/model defaults may prefill dispatch.
6. Refresh after external tool changes is explicit or uses the configured workbench interval. No conversation poller or second task store.
7. Update bundled skill, README, OVERVIEW, manifest and version together. Use only the compatible main SDK, no new dependencies or media.

Acceptance boundaries: real registered tool/RPC calls with controlled HTTP and synthetic public SDK resources (including accepted/unverified writes and partial dispatch); actual UI against real isolated daemon/RPC for retained details/workflow/iterations and actual main client registration/cleanup. Preserve safety/credential/project/cancellation/readback tests, remove retired-feature-only tests. Do not write real TAPD business data, run a production provider or restart the installed daemon. Install by reloading only the validated plugin after the fork integration PR merges.
