# Keep progress in TAPD; retain dispatch without responsibility state

The confirmed simplification removes conversation presentation and the separate local responsibility/classification system. TAPD items, workflow, labels and real parent-child links remain the domain model. Old local stores are left untouched and become inactive.

Dispatch remains a user-approved way to create a worktree and start an Agent. It returns host resource identities, creates no local owner and cannot guarantee that another Agent is not already working on the item. This trade-off removes reconciliation and duplicated progress in exchange for explicit host-resource inspection on partial/unknown dispatch and manual/configured UI refresh after tool writes.
