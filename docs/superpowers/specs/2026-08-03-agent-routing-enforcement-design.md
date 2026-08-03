# Agent Routing Enforcement Design

## Problem

The repository requires Claude to receive every implementation task first and permits a Codex implementation worker only after verified Claude account-capacity exhaustion. Documentation alone did not enforce that rule: the long-lived coordinator retained an older Run objective, uncommitted policy files were absent from newly created worktrees, and Orca accepted Codex worker creation without routing evidence.

The current Run created implementation tasks after the policy edit and dispatched them to Codex without the required `originalTaskId`, `originalDispatchId`, `observedAt`, or Claude-capacity evidence. Enforcement therefore needs both an immediate Run-level stop and a repository-level execution boundary.

## Goals

- Stop new implementation dispatches in the current Run until the routing policy is installed.
- Make Claude the default implementation worker in every local worktree.
- Fail normal Codex feature-edit verification and commit flows when no valid fallback grant exists.
- Permit a narrowly scoped Codex fallback only after verified Claude account-level exhaustion.
- Preserve Codex documentation, planning, review, merge, and verification duties.
- Record enough routing evidence to audit every allowed fallback.

## Non-goals

- Modify the Orca application or binary.
- Stop, delete, or replace existing terminals or worktrees.
- Undo already completed and reviewed Wave work.
- Claim protection against a human or malicious process that deliberately uses `--no-verify`, rewrites Git configuration, or edits the guard itself.
- Store account secrets, tokens, raw credentials, or full sensitive error responses.

## Layer 1: Immediate Run Gate

The current Run `run_85aff4ff9daf` must not begin Wave 6 implementation while the guard is absent.

1. Mark Wave 6 task `task_d053f99cc913` as blocked with a routing-enforcement reason.
2. Create an unresolved decision gate on that task requiring:
   - the routing policy and Claude settings to exist in the committed integration baseline;
   - the repository guard to be installed and verified;
   - a fresh read-only Claude usage check before implementation dispatch;
   - Claude dispatch when usage is available or unknown.
3. Send a high-priority message to the live coordinator instructing it to reload the committed policy and create no new Codex implementation worker without a valid fallback grant.
4. Do not stop current workers. Reviews and integration may finish, but new feature implementation remains blocked.

The gate is resolved only after the guard is integrated and the coordinator reports the preflight outcome. A proven account-level exhaustion may authorize a scoped fallback grant; an unknown result does not.

## Layer 2: Committed Policy Baseline

Before creating an enforcement implementation worktree, commit the approved routing policy and Claude configuration so every new child worktree inherits them:

- `AGENTS.md`
- `docs/agent-workflow.md`
- `.claude/settings.json`

The baseline keeps Fable as the initial Claude model and Opus as the Claude-internal fallback. Codex becomes eligible only after preflight proves account-wide exhaustion or Fable-to-Opus routing still ends in an account-level capacity error.

## Layer 3: Repository Guard

### Components

- `.githooks/pre-commit`: delegates to the routing guard from any worktree.
- `.githooks/post-commit`: consumes a grant after an authorized Codex fallback commit.
- `scripts/verify-agent-routing.mjs`: identifies the current agent context, classifies changed paths, validates grants, and exits nonzero on violations.
- `scripts/install-agent-routing-hooks.mjs`: configures the shared Git repository to use the versioned hook directory.
- `scripts/agent-routing-grant.mjs`: creates and consumes coordinator-issued fallback grants in the Git common directory, outside committed files.
- Focused tests under `scripts/*.test.mjs` or the repository's existing test convention.
- `package.json` scripts that run the guard before tests and builds and install the hook during repository setup.

### Agent Detection

The guard treats a session as Codex when the process contains stable Codex markers such as `CODEX_THREAD_ID` or `CODEX_HOME`. Orca terminal identity comes from `ORCA_TERMINAL_HANDLE`. Missing or contradictory identity fails closed when product-code changes are present.

Human sessions and Claude sessions are not classified as Codex. The tests must inject environment maps rather than relying on the developer machine's real environment.

### Path Classification

Codex may change coordinator-owned files without a fallback grant:

- Markdown documentation and plans under `docs/**`;
- repository instruction files such as `AGENTS.md`, `CLAUDE.md`, and `README.md`;
- approved routing configuration and guard infrastructure while initially installing the guard.

All application and service implementation paths require Claude or a valid fallback grant, including at minimum:

- `src/**`;
- `supabase/**`;
- `design-assets/**`;
- package, lock, build, test, and runtime configuration files;
- general scripts outside the routing-guard allowlist.

The classifier is explicit and test-driven. Unknown non-documentation paths fail closed for Codex rather than being silently allowed.

### Grant Storage And Schema

Fallback grants live below the shared Git common directory, for example:

```text
<git-common-dir>/orca-routing-grants/<terminal-handle>.json
```

Each grant contains:

```json
{
  "version": 1,
  "reason": "claude_account_capacity_exhausted",
  "terminalHandle": "term_...",
  "taskId": "task_...",
  "dispatchId": "ctx_... or not-created-preflight",
  "evidenceSource": "read-only usage check or Claude response classification",
  "observedAt": "ISO-8601 timestamp",
  "expiresAt": "ISO-8601 timestamp",
  "allowedPaths": ["exact/path-or-prefix"],
  "remainingScope": "bounded task remainder"
}
```

The grant command may run only from the primary integration worktree and must refuse child branches. It must not accept or persist secret values. The guard validates terminal identity, expiry, task metadata, allowed paths, and the exact reason. It queries `orca orchestration dispatch-show --task <taskId> --json` at validation time and requires the active Dispatch ID and assignee terminal to match the grant. A post-success step consumes the grant or records it as used so it cannot silently authorize unrelated later work.

Because `worker-start` injects immediately, a Codex fallback uses an explicit sequence: create or reuse an idle Codex terminal in the preserved worktree, create a provisional terminal-and-task grant, dispatch the Task, then finalize the grant with the returned Dispatch ID. Failure to finalize leaves the guard closed, so the worker cannot verify or commit product changes. The coordinator records the exact sequence in the fallback Task result.

### Verification And Commit Flow

1. `npm test` and `npm run build` invoke the guard against staged and unstaged product changes before running their normal commands.
2. `pre-commit` invokes the same guard against staged paths.
3. A Codex documentation-only commit passes without a grant.
4. A Codex feature commit without a grant fails with a concise explanation and the missing evidence fields.
5. An expired, mismatched, over-broad, or malformed grant fails closed.
6. A valid grant authorizes only its listed paths for its bound terminal, Task, and active Dispatch.
7. `post-commit` consumes the matching grant after the authorized commit.
8. Claude implementation and clean Codex review/integration work continue normally.

### Installation Across Local Worktrees

The installer sets the shared repository's `core.hooksPath` to the absolute versioned `.githooks` directory in the primary worktree. Git worktrees share that repository configuration, so existing and future local worktrees use the same hook even when an older branch lacks the hook files.

Repository setup also runs the installer so a fresh clone receives the hook configuration after `npm install`. Installation is idempotent and must verify the resolved target stays inside this repository before changing Git configuration.

## Implementation Ownership

The enforcement code changes behavior and therefore belongs to a Claude implementation worker in a new Orca child worktree based on the committed policy baseline. The worker owns only the guard, hook, focused tests, package script wiring, and narrowly necessary documentation updates. It must not modify product feature code.

Codex owns task specification, review, integration, Run-gate management, and final verification. The Codex coordinator does not implement the guard code.

## Test Matrix

Automated tests must cover:

- Claude product change: allowed.
- Human product change: allowed.
- Codex documentation-only change: allowed.
- Codex product change without grant: blocked.
- Codex product change with missing identity: blocked.
- Codex product change with malformed, expired, wrong-terminal, wrong-task, or wrong-path grant: blocked.
- Codex product change with a valid scoped grant: allowed.
- Grant reuse after consumption: blocked.
- Unknown non-documentation path from Codex: blocked.
- Hook installation in the primary repository and visibility from a linked worktree.
- Existing `npm test` and `npm run build` commands retain their original behavior after the guard passes.

Verification includes focused guard tests, the full test suite, build, audit, diff check, a temporary linked-worktree hook scenario, and a negative commit dry run that proves an ungranted Codex feature change is rejected without altering user files.

## Rollout

1. Commit this design separately without staging unrelated user changes.
2. Commit the approved policy and Claude settings baseline.
3. Apply the immediate Wave 6 block and coordinator message.
4. Dispatch the guard implementation to Claude through the existing Run.
5. Review and integrate the Claude commit.
6. Install and verify the shared hook.
7. Perform a fresh Claude usage preflight.
8. Resolve the Wave 6 gate only when the routing result is recorded and the chosen worker satisfies the policy.

## Limitations

This design is a strong workflow boundary, not an operating-system security sandbox. A human with repository write access can bypass Git hooks. Preventing raw `orca orchestration worker-start --agent codex` itself would require an Orca runtime policy feature outside this repository. Within the current project, the layered Run gate, inherited policy, verification guard, and commit hook prevent the accidental and ordinary agent path that caused the observed misrouting.
