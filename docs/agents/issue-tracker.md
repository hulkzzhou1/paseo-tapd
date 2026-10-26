# Issue tracker

Use GitHub Issues in the fork configured as this checkout's `origin` remote. The integration target is `main` in that same repository. Do not create issues or pull requests in the upstream repository.

Each implementation ticket links its originating spec and lists blocking tickets. Work ready tickets in separate worktrees based on the integration branch. A ticket is resolved by merging a pull request whose body contains `Closes #<issue-number>` for it.

Track the entire confirmed spec on one integration branch and its pull request. Open that pull request as a draft once implementation commits exist; mark it ready after the spec and standards reviews and required checks pass. The user has authorized merging the completed work into the fork's `main` after local validation.

Use the GitHub plugin when its tools are available; otherwise use `gh` with the repository resolved from `origin`. Write multiline issue and PR bodies to a file and pass `--body-file`.

PRs as a request surface: off.
