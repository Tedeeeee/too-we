# Agent Routing Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce Claude-first implementation across every local Git worktree and allow Codex product-code commits only with a short-lived, task-scoped fallback grant backed by verified Claude account-capacity exhaustion.

**Architecture:** A pure routing-policy module classifies agent identity, changed paths, and grant validity. Thin CLIs collect Git/Orca state, store grants below the shared Git common directory, and install shared hooks; pre-test, pre-build, and pre-commit entry points call the same verifier so normal Codex implementation paths fail closed. Hooks are configured to the primary worktree's absolute `.githooks` directory, which makes one committed policy apply to existing and future linked worktrees.

**Tech Stack:** Node.js ESM, Vitest, Git hooks, Orca CLI, npm scripts.

---

## File map

- Create `scripts/agent-routing-policy.mjs`: pure identity, path, expiry, scope, and dispatch validation functions.
- Create `scripts/agent-routing-policy.test.mjs`: unit tests for every allow/deny rule.
- Create `scripts/verify-agent-routing.mjs`: collect changed paths, load a grant, query Orca, and return a fail-closed exit status.
- Create `scripts/verify-agent-routing.test.mjs`: temporary-repository integration tests for staged and working-tree checks.
- Create `scripts/agent-routing-grant.mjs`: coordinator-only create/finalize/status/consume operations in the Git common directory.
- Create `scripts/agent-routing-grant.test.mjs`: grant lifecycle and replay tests.
- Create `scripts/install-agent-routing-hooks.mjs`: install the absolute shared hook path after validating repository boundaries.
- Create `scripts/install-agent-routing-hooks.test.mjs`: primary and linked-worktree installation tests.
- Create `.githooks/pre-commit`: verify staged paths.
- Create `.githooks/post-commit`: consume the reservation created by pre-commit.
- Modify `package.json`: add focused routing scripts plus `pretest`, `prebuild`, and idempotent installation wiring.
- Modify `docs/agent-workflow.md`: document exact grant and installation commands only if their final CLI differs from the approved design.

### Task 1: Pure routing policy

**Files:**

- Create: `scripts/agent-routing-policy.mjs`
- Test: `scripts/agent-routing-policy.test.mjs`

- [ ] **Step 1: Write failing identity and path-classification tests**

Test these exact cases with injected environment objects and POSIX-normalized repository-relative paths:

```js
expect(classifyAgent({ CODEX_THREAD_ID: 'thread', ORCA_TERMINAL_HANDLE: 'term_1' })).toBe('codex')
expect(classifyAgent({ CLAUDE_CODE_ENTRYPOINT: 'cli' })).toBe('claude')
expect(classifyAgent({})).toBe('human')
expect(classifyPath('docs/spec.md')).toBe('coordinator')
expect(classifyPath('AGENTS.md')).toBe('coordinator')
expect(classifyPath('src/App.jsx')).toBe('implementation')
expect(classifyPath('supabase/functions/purge/index.ts')).toBe('implementation')
expect(classifyPath('package.json')).toBe('implementation')
expect(classifyPath('unknown.bin')).toBe('implementation')
```

Also prove that missing `ORCA_TERMINAL_HANDLE` in a detected Codex process fails closed when implementation paths are present. Do not read the real test-process environment.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run scripts/agent-routing-policy.test.mjs`

Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement the minimal pure policy API**

Export:

```js
export function classifyAgent(env) {}
export function classifyPath(relativePath) {}
export function normalizeAllowedPaths(values) {}
export function validateGrant({ grant, env, changedPaths, dispatch, now }) {}
```

`validateGrant` must require version `1`, reason `claude_account_capacity_exhausted`, an exact terminal handle, a non-empty task ID, an exact finalized Dispatch ID, ISO `observedAt` and future `expiresAt`, non-empty bounded `remainingScope`, and explicit path-prefix coverage. It must reject malformed, expired, used/reserved-for-another-tree, wrong-terminal, wrong-task, wrong-dispatch, wrong-assignee, and over-broad grants. Never accept repository root, `*`, or an empty allowed path.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run scripts/agent-routing-policy.test.mjs`

Expected: PASS for Claude, human, documentation-only Codex, ungranted Codex, every malformed grant, and one valid scoped grant.

- [ ] **Step 5: Commit the pure policy**

```bash
git add scripts/agent-routing-policy.mjs scripts/agent-routing-policy.test.mjs
git commit -m "test: define agent routing policy"
```

### Task 2: Grant lifecycle

**Files:**

- Create: `scripts/agent-routing-grant.mjs`
- Test: `scripts/agent-routing-grant.test.mjs`

- [ ] **Step 1: Write failing grant lifecycle tests**

Use temporary Git repositories and dependency injection for command execution. Cover:

- create only from the primary worktree on `codex/mvp-integration`;
- reject missing evidence source/timestamp/scope or expiry beyond 60 minutes;
- write only to `<git-common-dir>/orca-routing-grants/<terminal>.json`;
- never persist arbitrary error bodies, tokens, keys, or environment values;
- finalize exactly once with a live task Dispatch whose assignee matches the terminal;
- reserve a grant for one staged tree, idempotently accept the same tree, and reject another tree;
- consume the reserved grant after commit and reject reuse.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run scripts/agent-routing-grant.test.mjs`

Expected: FAIL because the grant CLI does not exist.

- [ ] **Step 3: Implement the minimal CLI and importable functions**

Support these commands without accepting free-form secret-bearing payloads:

```text
node scripts/agent-routing-grant.mjs create --terminal <term> --task <task> --evidence-source <enum> --observed-at <iso> --expires-at <iso> --allowed-path <path> --remaining-scope <text>
node scripts/agent-routing-grant.mjs finalize --terminal <term> --dispatch <ctx>
node scripts/agent-routing-grant.mjs status --terminal <term>
node scripts/agent-routing-grant.mjs reserve --terminal <term> --tree <tree>
node scripts/agent-routing-grant.mjs consume --terminal <term> --tree <tree> --commit <sha>
```

Resolve the common directory and primary worktree with Git commands, validate resolved paths remain inside those exact roots, write atomically, and create the grant directory with user-only permissions where supported. The `finalize` operation must call `orca orchestration dispatch-show --task <taskId> --json` and match both Dispatch ID and assignee.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run scripts/agent-routing-grant.test.mjs`

Expected: PASS, including reuse and redaction cases.

- [ ] **Step 5: Commit the grant lifecycle**

```bash
git add scripts/agent-routing-grant.mjs scripts/agent-routing-grant.test.mjs
git commit -m "feat: add scoped routing grants"
```

### Task 3: Shared verifier

**Files:**

- Create: `scripts/verify-agent-routing.mjs`
- Test: `scripts/verify-agent-routing.test.mjs`

- [ ] **Step 1: Write failing verifier integration tests**

Create temporary Git repositories and inject environment plus an Orca command adapter. Cover `--staged` and default working-tree modes. Assert:

- Claude and human product changes pass;
- Codex documentation-only changes pass;
- Codex product or unknown-path changes without a grant exit nonzero;
- absent Codex terminal identity exits nonzero;
- malformed, expired, mismatched, or over-broad grants exit nonzero;
- a valid live scoped grant passes only for its paths;
- Orca unavailable, invalid JSON, missing Dispatch, and non-active Dispatch all fail closed;
- output lists missing evidence fields but never prints stored evidence details or environment values.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run scripts/verify-agent-routing.test.mjs`

Expected: FAIL because the verifier does not exist.

- [ ] **Step 3: Implement the minimal verifier**

For `--staged`, obtain paths from `git diff --cached --name-only --diff-filter=ACMR`. For default mode, combine staged, unstaged, and untracked paths without following paths outside the repository. Return success immediately for no changes, non-Codex sessions, or coordinator-only paths. For Codex implementation paths, load the exact terminal grant, query its task Dispatch, call the pure validator, and emit a concise Korean/English-neutral error that names the blocked paths and required grant fields.

When `--staged` succeeds with a grant, reserve it against `git write-tree`. Do not consume it yet.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npx vitest run scripts/verify-agent-routing.test.mjs`

Expected: PASS for the full allow/deny matrix.

- [ ] **Step 5: Commit the verifier**

```bash
git add scripts/verify-agent-routing.mjs scripts/verify-agent-routing.test.mjs
git commit -m "feat: verify implementation worker routing"
```

### Task 4: Hooks and all-worktree installation

**Files:**

- Create: `.githooks/pre-commit`
- Create: `.githooks/post-commit`
- Create: `scripts/install-agent-routing-hooks.mjs`
- Test: `scripts/install-agent-routing-hooks.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing installation and hook tests**

In a temporary primary repository plus linked worktree, prove the installer:

- resolves the primary worktree rather than the invoking child;
- sets shared `core.hooksPath` to the absolute primary `.githooks` directory;
- is idempotent;
- rejects a hook directory outside the repository;
- makes `git config --path --get core.hooksPath` return the same path from both worktrees.

Prove pre-commit blocks an ungranted Codex implementation commit and permits a Codex documentation commit. Prove post-commit consumes the matching reserved grant. The tests must use disposable files only and must not mutate the developer repository configuration.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run scripts/install-agent-routing-hooks.test.mjs`

Expected: FAIL because hooks and installer do not exist.

- [ ] **Step 3: Implement hooks and installer**

`.githooks/pre-commit` must locate the primary worktree using Git, then execute:

```sh
node "<primary-worktree>/scripts/verify-agent-routing.mjs" --staged
```

`.githooks/post-commit` must no-op unless the current session is Codex and a matching reservation exists, then call `consume` with the staged tree and new commit SHA. Quote paths for Windows Git Bash and POSIX shells.

Add package scripts equivalent to:

```json
{
  "agent-routing:verify": "node scripts/verify-agent-routing.mjs",
  "agent-routing:install": "node scripts/install-agent-routing-hooks.mjs",
  "agent-routing:test": "vitest run scripts/*agent-routing*.test.mjs",
  "pretest": "node scripts/verify-agent-routing.mjs",
  "prebuild": "node scripts/verify-agent-routing.mjs",
  "postinstall": "node scripts/install-agent-routing-hooks.mjs"
}
```

Preserve every existing script and behavior. The installer must safely no-op with a clear message when installed from a source archive without Git metadata.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm run agent-routing:test`

Expected: PASS, including the linked-worktree scenario and negative commit.

- [ ] **Step 5: Commit hooks and wiring**

```bash
git add .githooks/pre-commit .githooks/post-commit scripts/install-agent-routing-hooks.mjs scripts/install-agent-routing-hooks.test.mjs package.json
git commit -m "feat: enforce routing in every worktree"
```

### Task 5: Full verification and worker handoff

**Files:**

- Modify only if commands changed: `docs/agent-workflow.md`

- [ ] **Step 1: Run the focused routing suite**

Run: `npm run agent-routing:test`

Expected: all routing tests pass with no unexpected warnings.

- [ ] **Step 2: Run the complete repository checks**

Run:

```bash
npm test
npm run build
npm audit --audit-level=high
npm run svg:verify
npm run svg:verify-ui
npm run svg:verify-usage
npm run ui:verify-responsive
git diff --check
git status --short
```

Expected: tests and build pass, audit reports no high-severity vulnerability, SVG/responsive checks pass, diff check is clean, and status contains only the worker-owned routing files.

- [ ] **Step 3: Verify no product feature files changed**

Run: `git diff --name-only <worker-base>...HEAD`

Expected: only the files listed in this plan.

- [ ] **Step 4: Send `worker_done` exactly once**

Report commit SHAs, RED/GREEN evidence, focused/full verification results, files modified, and residual limitations. Then idle; do not merge or modify product feature code.

## Coordinator integration checklist

- Review the Claude worker's commits and full diff; dispatch corrections back to the same Claude worker.
- Re-run focused tests, full tests, build, audit, SVG, responsive, and diff checks from `codex/mvp-integration`.
- Merge only approved Claude commits.
- Run `npm run agent-routing:install` from `C:\couple2` and verify the absolute shared hook path from the primary and both preserved Wave 6 worktrees.
- Prove an ungranted Codex product change is rejected using only a disposable temporary linked worktree; do not touch user files.
- Perform a fresh read-only Claude usage check. If usage is unknown, dispatch Claude. Resolve the Wave 6 gate only after a live Claude Dispatch is visible.
