// @vitest-environment node
/**
 * 라우팅 정책 순수 함수 테스트.
 *
 * 실제 프로세스 환경(process.env)을 읽지 않는다 — 모든 케이스는 주입된 env 객체로 검증한다.
 * 개발자 머신이 Codex든 Claude든 결과가 같아야 하기 때문이다.
 */
import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_SOURCES,
  GRANT_REASON,
  classifyAgent,
  classifyPath,
  normalizeAllowedPaths,
  normalizeDispatch,
  validateGrant,
} from './agent-routing-policy.mjs';

const NOW = new Date('2026-08-03T12:00:00.000Z');
const TERMINAL = 'term_dd2dc226-4f0c-4af3-ac3c-ce5d97d135ec';
const TASK = 'task_288b4e349139';
const DISPATCH = 'ctx_e78bbc014ce7';

const CODEX_ENV = { CODEX_THREAD_ID: 'thread-1', ORCA_TERMINAL_HANDLE: TERMINAL };

function grantFixture(overrides = {}) {
  return {
    version: 1,
    reason: GRANT_REASON,
    status: 'active',
    terminalHandle: TERMINAL,
    taskId: TASK,
    dispatchId: DISPATCH,
    evidenceSource: 'claude-response-classification',
    observedAt: '2026-08-03T11:50:00.000Z',
    expiresAt: '2026-08-03T12:30:00.000Z',
    allowedPaths: ['src/data/api.js'],
    remainingScope: 'finish the remaining session restore fallback',
    createdAt: '2026-08-03T11:51:00.000Z',
    finalizedAt: '2026-08-03T11:52:00.000Z',
    ...overrides,
  };
}

function dispatchFixture(overrides = {}) {
  return {
    dispatchId: DISPATCH,
    taskId: TASK,
    status: 'active',
    assigneeTerminal: TERMINAL,
    ...overrides,
  };
}

function check(overrides = {}) {
  return validateGrant({
    grant: grantFixture(),
    env: CODEX_ENV,
    changedPaths: ['src/data/api.js'],
    dispatch: dispatchFixture(),
    now: NOW,
    ...overrides,
  });
}

describe('classifyAgent', () => {
  it('detects Codex from stable process markers', () => {
    expect(classifyAgent({ CODEX_THREAD_ID: 'thread', ORCA_TERMINAL_HANDLE: 'term_1' })).toBe('codex');
    expect(classifyAgent({ CODEX_HOME: 'C:/Users/x/.codex' })).toBe('codex');
    expect(classifyAgent({ ORCA_AGENT: 'codex' })).toBe('codex');
  });

  it('detects Claude Code sessions', () => {
    expect(classifyAgent({ CLAUDE_CODE_ENTRYPOINT: 'cli' })).toBe('claude');
    expect(classifyAgent({ CLAUDECODE: '1' })).toBe('claude');
    expect(classifyAgent({ ORCA_AGENT: 'claude' })).toBe('claude');
  });

  it('treats a bare environment as a human session', () => {
    expect(classifyAgent({})).toBe('human');
    expect(classifyAgent()).toBe('human');
    expect(classifyAgent(null)).toBe('human');
  });

  it('ignores empty marker values', () => {
    expect(classifyAgent({ CODEX_HOME: '', CODEX_THREAD_ID: '  ' })).toBe('human');
    expect(classifyAgent({ CLAUDECODE: '' })).toBe('human');
  });

  it('fails closed to Codex when identities contradict', () => {
    expect(classifyAgent({ CODEX_THREAD_ID: 'thread', CLAUDECODE: '1' })).toBe('codex');
  });
});

describe('classifyPath', () => {
  it('treats coordinator-owned documentation as coordinator work', () => {
    expect(classifyPath('docs/spec.md')).toBe('coordinator');
    expect(classifyPath('docs/superpowers/plans/2026-08-03-agent-routing-enforcement.md')).toBe('coordinator');
    expect(classifyPath('AGENTS.md')).toBe('coordinator');
    expect(classifyPath('CLAUDE.md')).toBe('coordinator');
    expect(classifyPath('README.md')).toBe('coordinator');
  });

  it('treats the guard itself as implementation work so Codex cannot disarm it', () => {
    // 가드를 조정자 allowlist에 넣으면 Codex가 가드를 고쳐 우회할 수 있다.
    // 설치는 Claude가 수행하므로 초기 예외를 둘 이유도 없다.
    expect(classifyPath('.claude/settings.json')).toBe('implementation');
    expect(classifyPath('.githooks/pre-commit')).toBe('implementation');
    expect(classifyPath('.githooks/post-commit')).toBe('implementation');
    expect(classifyPath('scripts/agent-routing-policy.mjs')).toBe('implementation');
    expect(classifyPath('scripts/agent-routing-policy.test.mjs')).toBe('implementation');
    expect(classifyPath('scripts/agent-routing-grant.mjs')).toBe('implementation');
    expect(classifyPath('scripts/verify-agent-routing.mjs')).toBe('implementation');
    expect(classifyPath('scripts/install-agent-routing-hooks.mjs')).toBe('implementation');
  });

  it('treats application, service, and configuration paths as implementation work', () => {
    expect(classifyPath('src/App.jsx')).toBe('implementation');
    expect(classifyPath('supabase/functions/purge/index.ts')).toBe('implementation');
    expect(classifyPath('design-assets/svg/index.js')).toBe('implementation');
    expect(classifyPath('package.json')).toBe('implementation');
    expect(classifyPath('package-lock.json')).toBe('implementation');
    expect(classifyPath('vite.config.js')).toBe('implementation');
    expect(classifyPath('index.html')).toBe('implementation');
  });

  it('treats general scripts outside the routing allowlist as implementation work', () => {
    expect(classifyPath('scripts/verify-svg.mjs')).toBe('implementation');
    expect(classifyPath('scripts/import-figma-svg.mjs')).toBe('implementation');
  });

  it('fails closed for unknown and non-documentation paths', () => {
    expect(classifyPath('unknown.bin')).toBe('implementation');
    expect(classifyPath('docs/screenshot.png')).toBe('implementation');
    expect(classifyPath('')).toBe('implementation');
    expect(classifyPath(null)).toBe('implementation');
    expect(classifyPath('../outside/file.md')).toBe('implementation');
    expect(classifyPath('C:/couple2/AGENTS.md')).toBe('implementation');
  });

  it('normalizes Windows separators before classifying', () => {
    expect(classifyPath('docs\\specs\\mvp.md')).toBe('coordinator');
    expect(classifyPath('src\\data\\api.js')).toBe('implementation');
    expect(classifyPath('./AGENTS.md')).toBe('coordinator');
  });
});

describe('normalizeAllowedPaths', () => {
  it('normalizes separators, leading dot-slash, and trailing slashes', () => {
    expect(normalizeAllowedPaths(['src\\data\\api.js']).paths).toEqual(['src/data/api.js']);
    expect(normalizeAllowedPaths('src/data/').paths).toEqual(['src/data']);
    expect(normalizeAllowedPaths(['./src/App.jsx']).paths).toEqual(['src/App.jsx']);
  });

  it('deduplicates while preserving order', () => {
    expect(normalizeAllowedPaths(['src/a.js', './src/a.js', 'src/b.js']).paths).toEqual(['src/a.js', 'src/b.js']);
  });

  it('rejects repository root, globs, traversal, and absolute paths', () => {
    const result = normalizeAllowedPaths(['', ' ', '.', './', '/', '*', '**', 'src/*', '../x', 'src/../..', '/etc/passwd', 'C:/couple2/src']);
    expect(result.paths).toEqual([]);
    expect(result.rejected).toHaveLength(12);
  });

  it('rejects non-string entries and a missing value', () => {
    expect(normalizeAllowedPaths([1, null, {}]).paths).toEqual([]);
    expect(normalizeAllowedPaths(undefined).paths).toEqual([]);
    expect(normalizeAllowedPaths(null).rejected).toEqual([]);
  });
});

describe('normalizeDispatch', () => {
  it('reads the canonical shape', () => {
    expect(normalizeDispatch(dispatchFixture())).toEqual({
      dispatchId: DISPATCH,
      taskId: TASK,
      status: 'active',
      terminalHandle: TERMINAL,
    });
  });

  it('reads the real `orca orchestration dispatch-show --json` contract', () => {
    // 실제 출력: result.dispatch envelope + snake_case + status 'dispatched'.
    // 이 세 가지를 못 읽으면 정상적인 fallback grant가 항상 거부된다.
    const real = {
      result: {
        dispatch: {
          id: DISPATCH,
          task_id: TASK,
          status: 'dispatched',
          assignee_handle: TERMINAL,
        },
      },
    };
    expect(normalizeDispatch(real)).toEqual({
      dispatchId: DISPATCH,
      taskId: TASK,
      status: 'dispatched',
      terminalHandle: TERMINAL,
    });
  });

  it('accepts a dispatched grant end to end', () => {
    const result = check({
      dispatch: {
        result: {
          dispatch: { id: DISPATCH, task_id: TASK, status: 'dispatched', assignee_handle: TERMINAL },
        },
      },
    });
    expect(result.reasons).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('reads common alternate field names', () => {
    expect(normalizeDispatch({ id: DISPATCH, task: TASK, state: 'running', terminal: TERMINAL })).toEqual({
      dispatchId: DISPATCH,
      taskId: TASK,
      status: 'running',
      terminalHandle: TERMINAL,
    });
  });

  it('unwraps single-object and list envelopes', () => {
    expect(normalizeDispatch({ dispatch: dispatchFixture() }).dispatchId).toBe(DISPATCH);
    expect(normalizeDispatch({ dispatches: [dispatchFixture()] }).dispatchId).toBe(DISPATCH);
    expect(normalizeDispatch([dispatchFixture()]).dispatchId).toBe(DISPATCH);
  });

  it('returns null for anything it cannot read', () => {
    expect(normalizeDispatch(null)).toBeNull();
    expect(normalizeDispatch('ctx_e78bbc014ce7')).toBeNull();
    expect(normalizeDispatch({})).toBeNull();
    expect(normalizeDispatch({ dispatches: [] })).toBeNull();
    expect(normalizeDispatch({ dispatchId: DISPATCH })).toBeNull();
  });
});

describe('validateGrant', () => {
  it('accepts a valid scoped grant for its own paths', () => {
    const result = check();
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.blockedPaths).toEqual([]);
  });

  it('accepts coordinator paths alongside granted implementation paths', () => {
    const result = check({ changedPaths: ['docs/notes.md', 'AGENTS.md', 'src/data/api.js'] });
    expect(result.ok).toBe(true);
  });

  it('accepts a directory prefix grant', () => {
    const result = check({
      grant: grantFixture({ allowedPaths: ['src/data'] }),
      changedPaths: ['src/data/api.js', 'src/data/repositories/visits.js'],
    });
    expect(result.ok).toBe(true);
  });

  it('blocks a sibling path that only shares a name prefix', () => {
    const result = check({
      grant: grantFixture({ allowedPaths: ['src/data'] }),
      changedPaths: ['src/database.js'],
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('paths_not_allowed');
    expect(result.blockedPaths).toEqual(['src/database.js']);
  });

  it('blocks paths outside the grant scope and names them', () => {
    const result = check({ changedPaths: ['src/data/api.js', 'src/App.jsx'] });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('paths_not_allowed');
    expect(result.blockedPaths).toEqual(['src/App.jsx']);
  });

  it('blocks a missing or non-object grant', () => {
    expect(check({ grant: null }).reasons).toContain('grant_missing');
    expect(check({ grant: 'grant' }).reasons).toContain('grant_missing');
    expect(check({ grant: [] }).reasons).toContain('grant_missing');
    expect(check({ grant: null }).missingFields).toContain('grant');
  });

  it('blocks an unsupported version and a wrong reason', () => {
    expect(check({ grant: grantFixture({ version: 2 }) }).reasons).toContain('grant_version_unsupported');
    expect(check({ grant: grantFixture({ version: '1' }) }).reasons).toContain('grant_version_unsupported');
    expect(check({ grant: grantFixture({ reason: 'fable_overloaded' }) }).reasons).toContain('grant_reason_invalid');
  });

  it('blocks an unfinalized or already consumed grant', () => {
    const provisional = grantFixture({ status: 'provisional', dispatchId: 'not-created-preflight', finalizedAt: undefined });
    expect(check({ grant: provisional }).reasons).toContain('grant_not_finalized');
    const consumed = grantFixture({ status: 'consumed', consumedAt: '2026-08-03T11:59:00.000Z', consumedCommit: 'abc123' });
    expect(check({ grant: consumed }).reasons).toContain('grant_already_consumed');
  });

  it('blocks a Codex session with no terminal identity', () => {
    const result = check({ env: { CODEX_THREAD_ID: 'thread-1' } });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('terminal_identity_missing');
    expect(result.missingFields).toContain('ORCA_TERMINAL_HANDLE');
  });

  it('blocks a grant bound to another terminal', () => {
    const result = check({ env: { CODEX_THREAD_ID: 'thread-1', ORCA_TERMINAL_HANDLE: 'term_someone_else' } });
    expect(result.reasons).toContain('terminal_mismatch');
  });

  it('blocks a grant with a missing task id', () => {
    expect(check({ grant: grantFixture({ taskId: '' }) }).reasons).toContain('task_id_missing');
    expect(check({ grant: grantFixture({ taskId: undefined }) }).missingFields).toContain('taskId');
  });

  it('blocks an evidence source outside the approved enum', () => {
    expect(check({ grant: grantFixture({ evidenceSource: 'because the model said so' }) }).reasons)
      .toContain('evidence_source_invalid');
    for (const source of EVIDENCE_SOURCES) {
      expect(check({ grant: grantFixture({ evidenceSource: source }) }).ok).toBe(true);
    }
  });

  it('blocks malformed or future observation timestamps', () => {
    expect(check({ grant: grantFixture({ observedAt: 'yesterday' }) }).reasons).toContain('observed_at_invalid');
    expect(check({ grant: grantFixture({ observedAt: '2026-08-03T12:30:00.000Z' }) }).reasons).toContain('observed_at_invalid');
  });

  it('blocks an expired or malformed expiry', () => {
    expect(check({ grant: grantFixture({ expiresAt: '2026-08-03T11:59:59.000Z' }) }).reasons).toContain('grant_expired');
    expect(check({ grant: grantFixture({ expiresAt: 'never' }) }).reasons).toContain('expires_at_invalid');
    expect(check({ grant: grantFixture({ expiresAt: undefined }) }).reasons).toContain('expires_at_invalid');
  });

  it('blocks an unbounded or empty remaining scope', () => {
    expect(check({ grant: grantFixture({ remainingScope: '  ' }) }).reasons).toContain('remaining_scope_invalid');
    expect(check({ grant: grantFixture({ remainingScope: 'x'.repeat(400) }) }).reasons).toContain('remaining_scope_invalid');
  });

  it('blocks over-broad, empty, and malformed allowed paths', () => {
    for (const allowedPaths of [[], ['.'], ['/'], ['*'], ['**'], ['src/*'], ['../src'], ['C:/couple2/src'], ['']]) {
      const result = check({ grant: grantFixture({ allowedPaths }) });
      expect(result.ok, JSON.stringify(allowedPaths)).toBe(false);
      expect(result.reasons, JSON.stringify(allowedPaths)).toContain('allowed_paths_invalid');
    }
  });

  it('blocks unknown top-level grant fields', () => {
    const result = check({ grant: grantFixture({ rawErrorBody: 'HTTP 429 ...' }) });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('grant_schema_unknown_field');
  });

  it('fails closed when the Orca dispatch cannot be read', () => {
    expect(check({ dispatch: null }).reasons).toContain('dispatch_unverified');
    expect(check({ dispatch: undefined }).reasons).toContain('dispatch_unverified');
  });

  it('blocks a dispatch that does not match the grant', () => {
    expect(check({ dispatch: dispatchFixture({ dispatchId: 'ctx_other' }) }).reasons).toContain('dispatch_id_mismatch');
    expect(check({ dispatch: dispatchFixture({ taskId: 'task_other' }) }).reasons).toContain('dispatch_task_mismatch');
    expect(check({ dispatch: dispatchFixture({ assigneeTerminal: 'term_other' }) }).reasons)
      .toContain('dispatch_assignee_mismatch');
  });

  it('blocks a dispatch that is no longer active', () => {
    for (const status of ['completed', 'failed', 'cancelled', 'unknown-state', '']) {
      const result = check({ dispatch: dispatchFixture({ status }) });
      expect(result.ok, status).toBe(false);
      expect(result.reasons, status).toContain('dispatch_inactive');
    }
  });

  it('blocks a grant reserved for a different staged tree', () => {
    const reserved = grantFixture({ reservation: { tree: 'tree-aaa', reservedAt: '2026-08-03T11:58:00.000Z' } });
    expect(check({ grant: reserved, tree: 'tree-bbb' }).reasons).toContain('grant_reserved_for_another_tree');
    expect(check({ grant: reserved, tree: 'tree-aaa' }).ok).toBe(true);
    expect(check({ grant: reserved }).ok).toBe(true);
  });

  it('reports every violation at once so the operator sees the whole gap', () => {
    const result = check({
      grant: grantFixture({ version: 9, reason: 'nope', evidenceSource: 'freeform', remainingScope: '' }),
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(4);
    expect(new Set(result.reasons).size).toBe(result.reasons.length);
  });

  it('never echoes stored evidence values back to the caller', () => {
    const result = check({
      grant: grantFixture({ expiresAt: '2026-08-03T11:00:00.000Z', remainingScope: 'sensitive scope text' }),
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('sensitive scope text');
    expect(serialized).not.toContain('claude-response-classification');
  });
});
