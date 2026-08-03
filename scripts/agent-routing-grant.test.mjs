// @vitest-environment node
/**
 * fallback grant 수명주기 테스트.
 *
 * 임시 Git 저장소에서 실제 git plumbing을 쓰고 Orca CLI만 주입한다. 개발자 저장소나
 * 사용자 Git 설정은 건드리지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { grantFilePath, readGrantFile, runGrant } from './agent-routing-grant.mjs';
import { INTEGRATION_BRANCH, addWorktree, cleanup, git, makeWorkspace, orcaStub } from './agent-routing-test-support.mjs';

const TERMINAL = 'term_dd2dc226-4f0c-4af3-ac3c-ce5d97d135ec';
const TASK = 'task_288b4e349139';
const DISPATCH = 'ctx_e78bbc014ce7';
const NOW = new Date('2026-08-03T12:00:00.000Z');
const OBSERVED = '2026-08-03T11:55:00.000Z';
const EXPIRES = '2026-08-03T12:40:00.000Z';

let workspace;
let output;

beforeEach(() => {
  workspace = makeWorkspace();
  output = [];
});

afterEach(() => {
  cleanup(workspace.root);
});

function invoke(argv, options = {}) {
  return runGrant({
    argv,
    cwd: options.cwd ?? workspace.primary,
    env: options.env ?? {},
    now: options.now ?? NOW,
    orca: options.orca ?? orcaStub({ dispatchId: DISPATCH, taskId: TASK, terminalHandle: TERMINAL }),
    log: (line) => output.push(String(line)),
    error: (line) => output.push(String(line)),
  });
}

function createArgs(overrides = {}) {
  const args = {
    '--terminal': TERMINAL,
    '--task': TASK,
    '--evidence-source': 'read-only-usage-check',
    '--observed-at': OBSERVED,
    '--expires-at': EXPIRES,
    '--allowed-path': 'src/data/api.js',
    '--remaining-scope': 'finish the remaining session restore work',
    ...overrides,
  };
  return ['create', ...Object.entries(args).flatMap(([flag, value]) => (value === null ? [] : [flag, value]))];
}

function create(overrides = {}, options = {}) {
  return invoke(createArgs(overrides), options);
}

function grantFile() {
  return grantFilePath({ cwd: workspace.primary, terminalHandle: TERMINAL });
}

describe('grant create', () => {
  it('writes a provisional grant below the shared Git common directory', () => {
    expect(create()).toBe(0);
    const file = grantFile();
    expect(path.dirname(file)).toBe(path.join(workspace.primary, '.git', 'orca-routing-grants'));
    expect(path.basename(file)).toBe(`${TERMINAL}.json`);

    const grant = readGrantFile(file);
    expect(grant.version).toBe(1);
    expect(grant.reason).toBe('claude_account_capacity_exhausted');
    expect(grant.status).toBe('provisional');
    expect(grant.dispatchId).toBe('not-created-preflight');
    expect(grant.terminalHandle).toBe(TERMINAL);
    expect(grant.taskId).toBe(TASK);
    expect(grant.allowedPaths).toEqual(['src/data/api.js']);
  });

  it('stores only the approved schema fields', () => {
    expect(create()).toBe(0);
    expect(Object.keys(readGrantFile(grantFile())).sort()).toEqual([
      'allowedPaths',
      'createdAt',
      'dispatchId',
      'evidenceSource',
      'expiresAt',
      'observedAt',
      'reason',
      'remainingScope',
      'status',
      'taskId',
      'terminalHandle',
      'version',
    ]);
  });

  it('accepts repeated --allowed-path flags', () => {
    expect(create({ '--allowed-path': null }, {})).toBe(1);
    output.length = 0;
    const argv = [...createArgs({ '--allowed-path': 'src/data/api.js' }), '--allowed-path', 'src/data/store.jsx'];
    expect(invoke(argv)).toBe(0);
    expect(readGrantFile(grantFile()).allowedPaths).toEqual(['src/data/api.js', 'src/data/store.jsx']);
  });

  it('refuses to run outside the primary worktree', () => {
    const linked = addWorktree(workspace, 'child', 'claude/feature');
    expect(create({}, { cwd: linked })).toBe(1);
    expect(output.join('\n')).toMatch(/primary worktree/i);
    expect(fs.existsSync(grantFile())).toBe(false);
  });

  it('refuses to run outside the integration branch', () => {
    git(workspace.primary, ['checkout', '-q', '-b', 'codex/side-branch']);
    expect(create()).toBe(1);
    expect(output.join('\n')).toContain(INTEGRATION_BRANCH);
    expect(fs.existsSync(grantFile())).toBe(false);
  });

  it('requires every evidence field', () => {
    for (const flag of ['--evidence-source', '--observed-at', '--expires-at', '--allowed-path', '--remaining-scope', '--task', '--terminal']) {
      output.length = 0;
      expect(create({ [flag]: null }), flag).toBe(1);
      expect(output.join('\n'), flag).toContain(flag);
      expect(fs.existsSync(grantFile()), flag).toBe(false);
    }
  });

  it('rejects an evidence source outside the approved enum', () => {
    expect(create({ '--evidence-source': 'the model looked tired' })).toBe(1);
    expect(fs.existsSync(grantFile())).toBe(false);
  });

  it('rejects an expiry beyond 60 minutes, in the past, or malformed', () => {
    for (const expiresAt of ['2026-08-03T13:01:00.000Z', '2026-08-03T11:59:00.000Z', 'in an hour']) {
      output.length = 0;
      expect(create({ '--expires-at': expiresAt }), expiresAt).toBe(1);
      expect(fs.existsSync(grantFile()), expiresAt).toBe(false);
    }
  });

  it('rejects a stale or future observation timestamp', () => {
    for (const observedAt of ['2026-08-03T10:30:00.000Z', '2026-08-03T12:05:00.000Z', 'just now']) {
      output.length = 0;
      expect(create({ '--observed-at': observedAt }), observedAt).toBe(1);
      expect(fs.existsSync(grantFile()), observedAt).toBe(false);
    }
  });

  it('rejects over-broad allowed paths and path traversal', () => {
    for (const allowedPath of ['.', '/', '*', 'src/*', '../outside', 'C:/couple2/src']) {
      output.length = 0;
      expect(create({ '--allowed-path': allowedPath }), allowedPath).toBe(1);
      expect(fs.existsSync(grantFile()), allowedPath).toBe(false);
    }
  });

  it('rejects a terminal handle that could escape the grant directory', () => {
    for (const terminal of ['../../evil', 'term_../escape', 'notaterminal', '']) {
      output.length = 0;
      expect(create({ '--terminal': terminal || null }), terminal).toBe(1);
    }
    const grantsDir = path.join(workspace.primary, '.git', 'orca-routing-grants');
    const stored = fs.existsSync(grantsDir) ? fs.readdirSync(grantsDir) : [];
    expect(stored).toEqual([]);
  });

  it('never persists secret-looking evidence text', () => {
    const secrets = [
      'retry with token sk-ant-api03-abcdefghijklmnop',
      'Authorization: Bearer abcdefghijklmnop',
      'set SUPABASE_SERVICE_ROLE_KEY=abcdef',
      'aGVsbG8gd29ybGQgdGhpcyBpcyBhIGxvbmcgYmFzZTY0IGJsb2IgZm9yIHRlc3Rpbmc=',
      'x'.repeat(400),
    ];
    for (const scope of secrets) {
      output.length = 0;
      expect(create({ '--remaining-scope': scope }), scope.slice(0, 24)).toBe(1);
      expect(fs.existsSync(grantFile()), scope.slice(0, 24)).toBe(false);
    }
  });

  it('rejects unknown flags and free-form payloads', () => {
    expect(invoke([...createArgs(), '--raw-error', '429 body'])).toBe(1);
    expect(fs.existsSync(grantFile())).toBe(false);
  });

  it('refuses to replace a live grant but replaces a consumed one', () => {
    expect(create()).toBe(0);
    output.length = 0;
    expect(create({ '--allowed-path': 'src' })).toBe(1);
    expect(create({ '--remaining-scope': 'widen the scope quietly' })).toBe(1);
    expect(readGrantFile(grantFile()).allowedPaths).toEqual(['src/data/api.js']);

    expect(invoke(['finalize', '--terminal', TERMINAL, '--dispatch', DISPATCH])).toBe(0);
    expect(invoke(['reserve', '--terminal', TERMINAL, '--tree', 'tree-a'])).toBe(0);
    expect(invoke(['consume', '--terminal', TERMINAL, '--tree', 'tree-a', '--commit', 'abc1234'])).toBe(0);
    expect(create({ '--remaining-scope': 'second authorized slice' })).toBe(0);
    expect(readGrantFile(grantFile()).status).toBe('provisional');
  });
});

describe('grant finalize', () => {
  beforeEach(() => {
    expect(create()).toBe(0);
    output.length = 0;
  });

  it('binds the live dispatch exactly once', () => {
    const orca = orcaStub({ dispatchId: DISPATCH, taskId: TASK, terminalHandle: TERMINAL });
    expect(invoke(['finalize', '--terminal', TERMINAL, '--dispatch', DISPATCH], { orca })).toBe(0);
    expect(orca.calls).toEqual([TASK]);

    const grant = readGrantFile(grantFile());
    expect(grant.status).toBe('active');
    expect(grant.dispatchId).toBe(DISPATCH);
    expect(grant.finalizedAt).toBe(NOW.toISOString());

    output.length = 0;
    expect(invoke(['finalize', '--terminal', TERMINAL, '--dispatch', DISPATCH])).toBe(1);
    expect(output.join('\n')).toContain('active');
    expect(readGrantFile(grantFile()).finalizedAt).toBe(NOW.toISOString());
  });

  it('rejects a dispatch whose assignee is a different terminal', () => {
    const orca = orcaStub({ dispatchId: DISPATCH, taskId: TASK, terminalHandle: 'term_someone_else' });
    expect(invoke(['finalize', '--terminal', TERMINAL, '--dispatch', DISPATCH], { orca })).toBe(1);
    expect(readGrantFile(grantFile()).status).toBe('provisional');
  });

  it('rejects a dispatch id that does not match the live dispatch', () => {
    const orca = orcaStub({ dispatchId: 'ctx_other', taskId: TASK, terminalHandle: TERMINAL });
    expect(invoke(['finalize', '--terminal', TERMINAL, '--dispatch', DISPATCH], { orca })).toBe(1);
    expect(readGrantFile(grantFile()).status).toBe('provisional');
  });

  it('fails closed when the dispatch is not active', () => {
    const orca = orcaStub({ dispatchId: DISPATCH, taskId: TASK, terminalHandle: TERMINAL, status: 'completed' });
    expect(invoke(['finalize', '--terminal', TERMINAL, '--dispatch', DISPATCH], { orca })).toBe(1);
  });

  it('fails closed when Orca is unavailable or returns unreadable output', () => {
    const broken = [
      { status: 127, stdout: '', stderr: 'orca: not found' },
      { status: 0, stdout: 'not json at all' },
      { status: 0, stdout: '{}' },
      { status: 1, stdout: '{"result":{"dispatch":{}}}' },
    ];
    for (const result of broken) {
      output.length = 0;
      expect(invoke(['finalize', '--terminal', TERMINAL, '--dispatch', DISPATCH], {
        orca: { dispatchShow: () => result },
      }), JSON.stringify(result)).toBe(1);
      expect(readGrantFile(grantFile()).status).toBe('provisional');
    }
    expect(invoke(['finalize', '--terminal', TERMINAL, '--dispatch', DISPATCH], {
      orca: { dispatchShow: () => { throw new Error('spawn ENOENT'); } },
    })).toBe(1);
  });

  it('rejects finalizing a grant that does not exist', () => {
    fs.rmSync(grantFile());
    expect(invoke(['finalize', '--terminal', TERMINAL, '--dispatch', DISPATCH])).toBe(1);
  });
});

describe('grant reserve and consume', () => {
  beforeEach(() => {
    expect(create()).toBe(0);
    expect(invoke(['finalize', '--terminal', TERMINAL, '--dispatch', DISPATCH])).toBe(0);
    output.length = 0;
  });

  it('reserves one staged tree idempotently and rejects another', () => {
    expect(invoke(['reserve', '--terminal', TERMINAL, '--tree', 'tree-a'])).toBe(0);
    expect(readGrantFile(grantFile()).reservation).toEqual({ tree: 'tree-a', reservedAt: NOW.toISOString() });
    expect(invoke(['reserve', '--terminal', TERMINAL, '--tree', 'tree-a'])).toBe(0);

    output.length = 0;
    expect(invoke(['reserve', '--terminal', TERMINAL, '--tree', 'tree-b'])).toBe(1);
    expect(readGrantFile(grantFile()).reservation.tree).toBe('tree-a');
  });

  it('consumes the reserved grant once and blocks reuse', () => {
    expect(invoke(['reserve', '--terminal', TERMINAL, '--tree', 'tree-a'])).toBe(0);
    expect(invoke(['consume', '--terminal', TERMINAL, '--tree', 'tree-a', '--commit', 'abc1234'])).toBe(0);

    const grant = readGrantFile(grantFile());
    expect(grant.status).toBe('consumed');
    expect(grant.consumedCommit).toBe('abc1234');
    expect(grant.consumedAt).toBe(NOW.toISOString());

    output.length = 0;
    expect(invoke(['consume', '--terminal', TERMINAL, '--tree', 'tree-a', '--commit', 'abc1234'])).toBe(1);
    expect(invoke(['reserve', '--terminal', TERMINAL, '--tree', 'tree-a'])).toBe(1);
  });

  it('refuses to consume a tree that was never reserved', () => {
    expect(invoke(['consume', '--terminal', TERMINAL, '--tree', 'tree-a', '--commit', 'abc1234'])).toBe(1);
    expect(invoke(['reserve', '--terminal', TERMINAL, '--tree', 'tree-a'])).toBe(0);
    expect(invoke(['consume', '--terminal', TERMINAL, '--tree', 'tree-b', '--commit', 'abc1234'])).toBe(1);
    expect(readGrantFile(grantFile()).status).toBe('active');
  });

  it('refuses to reserve an expired grant', () => {
    expect(invoke(['reserve', '--terminal', TERMINAL, '--tree', 'tree-a'], { now: new Date('2026-08-03T13:00:00.000Z') })).toBe(1);
  });
});

describe('grant status', () => {
  it('reports a redacted summary without evidence values', () => {
    expect(create({ '--remaining-scope': 'finish the visit photo retry path' })).toBe(0);
    output.length = 0;
    expect(invoke(['status', '--terminal', TERMINAL])).toBe(0);

    const printed = output.join('\n');
    expect(printed).toContain('provisional');
    expect(printed).toContain('allowedPaths=1');
    expect(printed).not.toContain('finish the visit photo retry path');
    expect(printed).not.toContain('read-only-usage-check');
  });

  it('reports a missing grant without failing', () => {
    expect(invoke(['status', '--terminal', TERMINAL])).toBe(0);
    expect(output.join('\n')).toMatch(/no grant/i);
  });
});

describe('grant CLI surface', () => {
  it('rejects unknown subcommands and prints usage', () => {
    expect(invoke(['destroy', '--terminal', TERMINAL])).toBe(1);
    expect(invoke([])).toBe(1);
    expect(output.join('\n')).toMatch(/usage/i);
  });

  it('rejects a malformed task id before shelling out to Orca', () => {
    const orca = { dispatchShow: () => { throw new Error('must not be called'); } };
    expect(create({ '--task': 'task_$(whoami)' }, { orca })).toBe(1);
    expect(create({ '--task': 'not-a-task' }, { orca })).toBe(1);
  });

  it('rejects a malformed dispatch id, tree, and commit', () => {
    expect(create()).toBe(0);
    expect(invoke(['finalize', '--terminal', TERMINAL, '--dispatch', 'ctx_$(id)'])).toBe(1);
    expect(invoke(['reserve', '--terminal', TERMINAL, '--tree', 'tree a; rm -rf /'])).toBe(1);
    expect(invoke(['finalize', '--terminal', TERMINAL, '--dispatch', DISPATCH])).toBe(0);
    expect(invoke(['reserve', '--terminal', TERMINAL, '--tree', 'tree-a'])).toBe(0);
    expect(invoke(['consume', '--terminal', TERMINAL, '--tree', 'tree-a', '--commit', 'not a sha'])).toBe(1);
  });
});
