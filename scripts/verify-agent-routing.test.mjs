// @vitest-environment node
/**
 * 공용 라우팅 검증기 통합 테스트.
 *
 * 임시 Git 저장소에서 실제 staged/working-tree 상태를 만들고 환경과 Orca만 주입한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { grantFilePath, readGrantFile, runGrant } from './agent-routing-grant.mjs';
import { addWorktree, cleanup, git, makeWorkspace, orcaStub, writeFile } from './agent-routing-test-support.mjs';
import { runVerify } from './verify-agent-routing.mjs';

const TERMINAL = 'term_dd2dc226-4f0c-4af3-ac3c-ce5d97d135ec';
const TASK = 'task_288b4e349139';
const DISPATCH = 'ctx_e78bbc014ce7';
const RUN = 'run_85aff4ff9daf';
const COORDINATOR = 'term_1a050ae1-f664-434f-a545-0ea73728d5ed';
const NOW = new Date('2026-08-03T12:00:00.000Z');

const CODEX_ENV = { CODEX_THREAD_ID: 'thread-1', ORCA_TERMINAL_HANDLE: TERMINAL, SUPABASE_SERVICE_ROLE_KEY: 'must-not-leak' };
const CLAUDE_ENV = { CLAUDECODE: '1', ORCA_TERMINAL_HANDLE: 'term_claude' };

let workspace;
let output;

beforeEach(() => {
  workspace = makeWorkspace();
  output = [];
});

afterEach(() => {
  cleanup(workspace.root);
});

function verify(argv = [], options = {}) {
  return runVerify({
    argv,
    cwd: options.cwd ?? workspace.primary,
    env: options.env ?? CODEX_ENV,
    now: options.now ?? NOW,
    orca: options.orca ?? orcaStub({ dispatchId: DISPATCH, taskId: TASK, terminalHandle: TERMINAL }),
    log: (line) => output.push(String(line)),
    error: (line) => output.push(String(line)),
  });
}

/** 파일을 만들고 index에 올린다. */
function stage(relativePath, contents = 'change\n') {
  writeFile(workspace.primary, relativePath, contents);
  git(workspace.primary, ['add', '--', relativePath]);
}

function grantFile() {
  return grantFilePath({ cwd: workspace.primary, terminalHandle: TERMINAL });
}

/** grant 파일을 직접 쓴다 — CLI가 막는 형태까지 검증기 앞에 놓기 위한 것. */
function putGrant(overrides = {}) {
  const grant = {
    version: 1,
    reason: 'claude_account_capacity_exhausted',
    status: 'active',
    terminalHandle: TERMINAL,
    taskId: TASK,
    dispatchId: DISPATCH,
    runId: RUN,
    issuedByCoordinatorHandle: COORDINATOR,
    evidenceSource: 'read-only-usage-check',
    observedAt: '2026-08-03T11:55:00.000Z',
    expiresAt: '2026-08-03T12:40:00.000Z',
    allowedPaths: ['src/data/api.js'],
    remainingScope: 'finish the remaining session restore work',
    createdAt: '2026-08-03T11:56:00.000Z',
    finalizedAt: '2026-08-03T11:57:00.000Z',
    ...overrides,
  };
  const file = grantFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(grant, null, 2)}\n`);
  return grant;
}

function stagedTree() {
  return git(workspace.primary, ['write-tree']);
}

describe('sessions that need no grant', () => {
  it('passes a Claude product change', () => {
    stage('src/data/api.js');
    expect(verify(['--staged'], { env: CLAUDE_ENV })).toBe(0);
  });

  it('passes a human product change', () => {
    stage('src/data/api.js');
    expect(verify(['--staged'], { env: {} })).toBe(0);
  });

  it('passes a Codex change with nothing staged', () => {
    expect(verify(['--staged'])).toBe(0);
  });

  it('passes a Codex documentation-only change', () => {
    stage('docs/specs/notes.md', '# notes\n');
    stage('AGENTS.md', '# rules\n');
    stage('README.md', '# readme\n');
    expect(verify(['--staged'])).toBe(0);
    expect(output.join('\n')).not.toMatch(/grant/i);
  });
});

describe('Codex implementation changes without a grant', () => {
  it('blocks a product change and names the blocked path', () => {
    stage('src/data/api.js');
    expect(verify(['--staged'])).toBe(1);
    const printed = output.join('\n');
    expect(printed).toContain('src/data/api.js');
    expect(printed).toContain('grant');
  });

  it('blocks the guard itself so Codex cannot disarm it', () => {
    stage('scripts/verify-agent-routing.mjs', '// disabled\n');
    stage('.githooks/pre-commit', '#!/bin/sh\nexit 0\n');
    stage('package.json', '{}\n');
    expect(verify(['--staged'])).toBe(1);
    const printed = output.join('\n');
    expect(printed).toContain('scripts/verify-agent-routing.mjs');
    expect(printed).toContain('.githooks/pre-commit');
    expect(printed).toContain('package.json');
  });

  it('blocks a staged deletion of a product file', () => {
    // ACMR만 보면 삭제가 가드를 통째로 빠져나간다.
    stage('src/data/api.js');
    git(workspace.primary, ['commit', '-q', '-m', 'seed api', '--no-verify']);
    git(workspace.primary, ['rm', '-q', '--', 'src/data/api.js']);

    expect(verify(['--staged'])).toBe(1);
    expect(output.join('\n')).toContain('src/data/api.js');
  });

  it('blocks an unknown non-documentation path', () => {
    stage('mystery.bin', 'binary-ish\n');
    stage('docs/screenshot.png', 'png-ish\n');
    expect(verify(['--staged'])).toBe(1);
    expect(output.join('\n')).toContain('mystery.bin');
  });

  it('blocks a Codex session with no Orca terminal identity', () => {
    stage('src/data/api.js');
    expect(verify(['--staged'], { env: { CODEX_THREAD_ID: 'thread-1' } })).toBe(1);
    expect(output.join('\n')).toContain('ORCA_TERMINAL_HANDLE');
  });

  it('names the required --run flag in its grant guidance', () => {
    // 안내문에 --run이 빠지면 코디네이터가 그대로 복사해 실행했을 때 create가 실패한다.
    stage('src/data/api.js');
    expect(verify(['--staged'])).toBe(1);
    expect(output.join('\n')).toContain('--run <run>');
  });

  it('never prints environment values or stored evidence', () => {
    stage('src/data/api.js');
    putGrant({ expiresAt: '2026-08-03T11:00:00.000Z' });
    expect(verify(['--staged'])).toBe(1);
    const printed = output.join('\n');
    expect(printed).not.toContain('must-not-leak');
    expect(printed).not.toContain('read-only-usage-check');
    expect(printed).not.toContain('finish the remaining session restore work');
  });
});

describe('grant validation through the verifier', () => {
  beforeEach(() => {
    stage('src/data/api.js');
  });

  it('passes a valid live scoped grant', () => {
    putGrant();
    expect(verify(['--staged'])).toBe(0);
  });

  it('blocks a malformed grant file', () => {
    const file = grantFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ not json');
    expect(verify(['--staged'])).toBe(1);
  });

  it('blocks expired, unfinalized, and consumed grants', () => {
    for (const overrides of [
      { expiresAt: '2026-08-03T11:00:00.000Z' },
      { status: 'provisional', dispatchId: 'not-created-preflight' },
      { status: 'consumed', consumedAt: '2026-08-03T11:58:00.000Z', consumedCommit: 'abc1234' },
    ]) {
      output.length = 0;
      putGrant(overrides);
      expect(verify(['--staged']), JSON.stringify(overrides)).toBe(1);
    }
  });

  it('blocks a grant bound to another terminal or task', () => {
    putGrant({ terminalHandle: 'term_other' });
    expect(verify(['--staged'])).toBe(1);

    output.length = 0;
    putGrant({ taskId: 'task_other' });
    expect(verify(['--staged'])).toBe(1);
  });

  it('blocks an over-broad grant', () => {
    for (const allowedPaths of [['.'], ['*'], ['src/*'], []]) {
      output.length = 0;
      putGrant({ allowedPaths });
      expect(verify(['--staged']), JSON.stringify(allowedPaths)).toBe(1);
    }
  });

  it('authorizes only the granted paths', () => {
    putGrant({ allowedPaths: ['src/data'] });
    expect(verify(['--staged'])).toBe(0);

    output.length = 0;
    stage('src/App.jsx');
    expect(verify(['--staged'])).toBe(1);
    expect(output.join('\n')).toContain('src/App.jsx');
    expect(output.join('\n')).not.toContain('src/data/api.js');
  });

  it('fails closed on every unreadable Orca result', () => {
    putGrant();
    const broken = [
      { status: 127, stdout: '', stderr: 'orca: not found' },
      { status: 0, stdout: 'not json' },
      { status: 0, stdout: '{}' },
      { status: 0, stdout: JSON.stringify({ result: { dispatch: { id: DISPATCH, task_id: TASK, status: 'completed', assignee_handle: TERMINAL } } }) },
    ];
    for (const result of broken) {
      output.length = 0;
      expect(verify(['--staged'], { orca: { dispatchShow: () => result } }), JSON.stringify(result)).toBe(1);
    }
    output.length = 0;
    expect(verify(['--staged'], { orca: { dispatchShow: () => { throw new Error('spawn ENOENT'); } } })).toBe(1);
  });

  it('blocks a dispatch assigned to a different terminal', () => {
    putGrant();
    const orca = orcaStub({ dispatchId: DISPATCH, taskId: TASK, terminalHandle: 'term_other' });
    expect(verify(['--staged'], { orca })).toBe(1);
  });
});

describe('staged versus working-tree modes', () => {
  it('checks only the index in staged mode', () => {
    stage('docs/notes.md', '# notes\n');
    writeFile(workspace.primary, 'src/data/api.js', 'unstaged\n');
    expect(verify(['--staged'])).toBe(0);
  });

  it('checks staged, unstaged, and untracked paths in the default mode', () => {
    writeFile(workspace.primary, 'src/data/api.js', 'untracked\n');
    expect(verify([])).toBe(1);
    expect(output.join('\n')).toContain('src/data/api.js');

    output.length = 0;
    git(workspace.primary, ['add', '--', 'src/data/api.js']);
    git(workspace.primary, ['commit', '-q', '-m', 'seed api', '--no-verify']);
    writeFile(workspace.primary, 'src/data/api.js', 'modified but unstaged\n');
    expect(verify([])).toBe(1);
  });

  it('reserves the grant against the staged tree only in staged mode', () => {
    stage('src/data/api.js');
    putGrant();

    expect(verify([])).toBe(0);
    expect(readGrantFile(grantFile()).reservation).toBeUndefined();

    const tree = stagedTree();
    expect(verify(['--staged'])).toBe(0);
    expect(readGrantFile(grantFile()).reservation).toEqual({ tree, reservedAt: NOW.toISOString() });
  });

  it('refuses a second staged tree once the grant is reserved', () => {
    stage('src/data/api.js');
    putGrant();
    expect(verify(['--staged'])).toBe(0);

    stage('src/data/api.js', 'a different change\n');
    output.length = 0;
    expect(verify(['--staged'])).toBe(1);
  });

  it('rejects unknown flags', () => {
    expect(verify(['--all'])).toBe(1);
    expect(output.join('\n')).toMatch(/--all/);
  });
});

describe('linked worktrees', () => {
  it('reads the grant from the shared common directory', () => {
    const linked = addWorktree(workspace, 'child', 'claude/feature');
    writeFile(linked, 'src/data/api.js', 'change\n');
    git(linked, ['add', '--', 'src/data/api.js']);

    expect(verify(['--staged'], { cwd: linked })).toBe(1);

    output.length = 0;
    putGrant();
    expect(verify(['--staged'], { cwd: linked })).toBe(0);
  });
});

describe('grant CLI and verifier agree', () => {
  it('opens the guard only after create plus finalize', () => {
    const orca = orcaStub({ dispatchId: DISPATCH, taskId: TASK, terminalHandle: TERMINAL });
    const grantArgs = [
      'create',
      '--terminal', TERMINAL,
      '--task', TASK,
      '--run', RUN,
      '--evidence-source', 'read-only-usage-check',
      '--observed-at', '2026-08-03T11:55:00.000Z',
      '--expires-at', '2026-08-03T12:40:00.000Z',
      '--allowed-path', 'src/data/api.js',
      '--remaining-scope', 'finish the remaining session restore work',
    ];
    const grantOptions = {
      cwd: workspace.primary,
      env: { ORCA_TERMINAL_HANDLE: COORDINATOR },
      now: NOW,
      orca,
      log: () => {},
      error: () => {},
    };
    expect(runGrant({ ...grantOptions, argv: grantArgs })).toBe(0);

    stage('src/data/api.js');
    expect(verify(['--staged'])).toBe(1);

    output.length = 0;
    expect(runGrant({ ...grantOptions, argv: ['finalize', '--terminal', TERMINAL, '--dispatch', DISPATCH] })).toBe(0);
    expect(verify(['--staged'])).toBe(0);
  });
});
