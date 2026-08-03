// @vitest-environment node
/**
 * 훅 설치와 실제 커밋 시나리오 테스트.
 *
 * 폐기용 임시 저장소에서만 `git config`를 바꾼다. 개발자 저장소나 전역 Git 설정은
 * 건드리지 않는다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { grantFilePath, readGrantFile, runGrant } from './agent-routing-grant.mjs';
import {
  addWorktree,
  cleanup,
  git,
  installGuardFiles,
  makeClone,
  makeWorkspace,
  orcaStub,
  tryGit,
  writeFile,
} from './agent-routing-test-support.mjs';
import { runInstall } from './install-agent-routing-hooks.mjs';

const TERMINAL = 'term_dd2dc226-4f0c-4af3-ac3c-ce5d97d135ec';
const TASK = 'task_288b4e349139';
const DISPATCH = 'ctx_e78bbc014ce7';

const CODEX_ENV = { CODEX_THREAD_ID: 'thread-1', ORCA_TERMINAL_HANDLE: TERMINAL };

let workspace;
let output;

beforeEach(() => {
  workspace = makeWorkspace();
  output = [];
});

afterEach(() => {
  cleanup(workspace.root);
});

function install(options = {}) {
  return runInstall({
    argv: options.argv ?? [],
    cwd: options.cwd ?? workspace.primary,
    log: (line) => output.push(String(line)),
    error: (line) => output.push(String(line)),
  });
}

function posix(value) {
  return value.split(path.sep).join('/');
}

function configuredHooksPath(cwd) {
  return git(cwd, ['config', '--path', '--get', 'core.hooksPath']);
}

function expectedHooksPath() {
  return posix(path.join(workspace.primary, '.githooks'));
}

describe('hook installation', () => {
  beforeEach(() => {
    installGuardFiles(workspace.primary);
  });

  it('points the shared repository at the primary .githooks directory', () => {
    expect(install()).toBe(0);
    expect(configuredHooksPath(workspace.primary)).toBe(expectedHooksPath());
  });

  it('resolves the primary worktree even when invoked from a child worktree', () => {
    const linked = addWorktree(workspace, 'child', 'claude/feature');
    fs.mkdirSync(path.join(linked, '.githooks'), { recursive: true });

    expect(install({ cwd: linked })).toBe(0);
    expect(configuredHooksPath(linked)).toBe(expectedHooksPath());
    expect(configuredHooksPath(linked)).not.toContain('child');
  });

  it('is visible from every linked worktree', () => {
    expect(install()).toBe(0);
    const linked = addWorktree(workspace, 'child', 'claude/feature');
    expect(configuredHooksPath(linked)).toBe(configuredHooksPath(workspace.primary));
  });

  it('is idempotent and reports that nothing changed', () => {
    expect(install()).toBe(0);
    output.length = 0;
    expect(install()).toBe(0);
    expect(output.join('\n')).toMatch(/이미|already/i);
    expect(configuredHooksPath(workspace.primary)).toBe(expectedHooksPath());
  });

  it('refuses a hook directory outside the repository', () => {
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'outside-hooks-')));
    try {
      expect(install({ argv: ['--hooks-dir', outside] })).toBe(1);
      expect(tryGit(workspace.primary, ['config', '--get', 'core.hooksPath']).stdout.trim())
        .not.toContain('outside-hooks-');
    } finally {
      cleanup(outside);
    }
  });

  it('refuses a hook directory that does not exist', () => {
    expect(install({ argv: ['--hooks-dir', path.join(workspace.primary, 'nope') ] })).toBe(1);
  });

  it('no-ops with a clear message outside a Git repository', () => {
    const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'no-git-')));
    try {
      expect(install({ cwd: bare })).toBe(0);
      expect(output.join('\n')).toMatch(/Git/);
    } finally {
      cleanup(bare);
    }
  });
});

describe('hook line endings', () => {
  beforeEach(() => {
    installGuardFiles(workspace.primary);
  });

  /**
   * CRLF로 체크아웃되면 CR을 토큰에 포함시키는 셸에서 `verifier=...`에 CR이 붙어
   * `[ ! -f "$verifier" ]`가 참이 되고, 훅이 조용히 통과해 가드가 열린다. 그래서
   * `.gitattributes`가 훅만 LF로 고정한다.
   */
  function expectLfHooks(dir) {
    for (const hook of ['pre-commit', 'post-commit']) {
      const file = path.join(dir, '.githooks', hook);
      const bytes = fs.readFileSync(file);
      expect(bytes.includes(0x0d), `${dir} ${hook} 에 CR이 있다`).toBe(false);
      expect(git(dir, ['ls-files', '--eol', '--', `.githooks/${hook}`])).toContain('w/lf');
    }
  }

  it('checks the hooks out as LF in a fresh clone with autocrlf enabled', () => {
    const clone = makeClone(workspace, 'fresh-clone');
    expectLfHooks(clone);
  });

  it('checks the hooks out as LF in a linked worktree', () => {
    const linked = addWorktree(workspace, 'child', 'claude/feature');
    expectLfHooks(linked);
  });

  it('runs a checked-out hook well enough to block an ungranted Codex commit', () => {
    const clone = makeClone(workspace, 'fresh-clone');
    expect(runInstall({ argv: [], cwd: clone, log: () => {}, error: (line) => output.push(String(line)) })).toBe(0);

    const before = git(clone, ['rev-parse', 'HEAD']);
    writeFile(clone, 'src/data/api.js', 'codex edit\n');
    git(clone, ['add', '--', 'src/data/api.js']);

    const result = tryGit(clone, ['commit', '-m', 'codex product edit'], CODEX_ENV);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('src/data/api.js');
    expect(git(clone, ['rev-parse', 'HEAD'])).toBe(before);
  });

  it('runs a checked-out hook well enough to permit a Codex documentation commit', () => {
    const clone = makeClone(workspace, 'fresh-clone');
    expect(runInstall({ argv: [], cwd: clone, log: () => {}, error: (line) => output.push(String(line)) })).toBe(0);

    writeFile(clone, 'docs/notes.md', '# notes\n');
    git(clone, ['add', '--', 'docs/notes.md']);
    expect(tryGit(clone, ['commit', '-m', 'docs: notes'], CODEX_ENV).status).toBe(0);
  });
});

describe('pre-commit hook', () => {
  beforeEach(() => {
    installGuardFiles(workspace.primary);
    expect(install()).toBe(0);
  });

  it('blocks an ungranted Codex implementation commit and leaves HEAD alone', () => {
    const before = git(workspace.primary, ['rev-parse', 'HEAD']);
    writeFile(workspace.primary, 'src/data/api.js', 'codex edit\n');
    git(workspace.primary, ['add', '--', 'src/data/api.js']);

    const result = tryGit(workspace.primary, ['commit', '-m', 'codex product edit'], CODEX_ENV);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('src/data/api.js');
    expect(git(workspace.primary, ['rev-parse', 'HEAD'])).toBe(before);
    expect(git(workspace.primary, ['diff', '--cached', '--name-only'])).toBe('src/data/api.js');
  });

  it('permits a Codex documentation commit', () => {
    writeFile(workspace.primary, 'docs/notes.md', '# notes\n');
    git(workspace.primary, ['add', '--', 'docs/notes.md']);

    const result = tryGit(workspace.primary, ['commit', '-m', 'docs: notes'], CODEX_ENV);
    expect(result.status).toBe(0);
    expect(git(workspace.primary, ['log', '-1', '--pretty=%s'])).toBe('docs: notes');
  });

  it('permits a Claude implementation commit', () => {
    writeFile(workspace.primary, 'src/data/api.js', 'claude edit\n');
    git(workspace.primary, ['add', '--', 'src/data/api.js']);

    const result = tryGit(workspace.primary, ['commit', '-m', 'feat: claude edit'], {
      CLAUDECODE: '1',
      CODEX_THREAD_ID: '',
      CODEX_HOME: '',
      ORCA_TERMINAL_HANDLE: 'term_claude',
    });
    expect(result.status).toBe(0);
  });

  it('blocks a Codex commit from a linked worktree too', () => {
    const linked = addWorktree(workspace, 'child', 'claude/feature');
    writeFile(linked, 'src/data/api.js', 'codex edit in child\n');
    git(linked, ['add', '--', 'src/data/api.js']);

    const result = tryGit(linked, ['commit', '-m', 'codex product edit'], CODEX_ENV);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('src/data/api.js');
  });
});

describe('post-commit hook', () => {
  beforeEach(() => {
    installGuardFiles(workspace.primary);
    expect(install()).toBe(0);
  });

  /** 예약된 활성 grant를 만든다. consume은 Orca를 부르지 않으므로 스텁으로 충분하다. */
  function reservedGrant() {
    const options = {
      cwd: workspace.primary,
      now: new Date(),
      orca: orcaStub({ dispatchId: DISPATCH, taskId: TASK, terminalHandle: TERMINAL }),
      log: () => {},
      error: (line) => output.push(String(line)),
    };
    const observedAt = new Date(Date.now() - 60_000).toISOString();
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    expect(runGrant({
      ...options,
      argv: [
        'create',
        '--terminal', TERMINAL,
        '--task', TASK,
        '--evidence-source', 'read-only-usage-check',
        '--observed-at', observedAt,
        '--expires-at', expiresAt,
        '--allowed-path', 'src/data/api.js',
        '--remaining-scope', 'finish the remaining session restore work',
      ],
    })).toBe(0);
    expect(runGrant({ ...options, argv: ['finalize', '--terminal', TERMINAL, '--dispatch', DISPATCH] })).toBe(0);
    const tree = git(workspace.primary, ['write-tree']);
    expect(runGrant({ ...options, argv: ['reserve', '--terminal', TERMINAL, '--tree', tree] })).toBe(0);
    return tree;
  }

  it('consumes the reserved grant after the authorized commit', () => {
    writeFile(workspace.primary, 'src/data/api.js', 'granted codex edit\n');
    git(workspace.primary, ['add', '--', 'src/data/api.js']);
    reservedGrant();

    const result = tryGit(workspace.primary, ['commit', '-m', 'feat: granted edit', '--no-verify'], CODEX_ENV);
    expect(result.status).toBe(0);

    const grant = readGrantFile(grantFilePath({ cwd: workspace.primary, terminalHandle: TERMINAL }));
    expect(grant.status).toBe('consumed');
    expect(grant.consumedCommit).toBe(git(workspace.primary, ['rev-parse', 'HEAD']));
  });

  it('leaves a grant reserved for a different tree untouched', () => {
    writeFile(workspace.primary, 'src/data/api.js', 'granted codex edit\n');
    git(workspace.primary, ['add', '--', 'src/data/api.js']);
    reservedGrant();

    writeFile(workspace.primary, 'src/data/api.js', 'a different edit\n');
    git(workspace.primary, ['add', '--', 'src/data/api.js']);
    const result = tryGit(workspace.primary, ['commit', '-m', 'feat: other edit', '--no-verify'], CODEX_ENV);
    expect(result.status).toBe(0);

    const grant = readGrantFile(grantFilePath({ cwd: workspace.primary, terminalHandle: TERMINAL }));
    expect(grant.status).toBe('active');
    expect(grant.consumedCommit).toBeUndefined();
  });

  it('never fails a commit when there is no grant to consume', () => {
    writeFile(workspace.primary, 'docs/notes.md', '# notes\n');
    git(workspace.primary, ['add', '--', 'docs/notes.md']);
    const result = tryGit(workspace.primary, ['commit', '-m', 'docs: notes'], CODEX_ENV);
    expect(result.status).toBe(0);
  });

  it('does not consume a grant for a Claude commit', () => {
    writeFile(workspace.primary, 'src/data/api.js', 'claude edit\n');
    git(workspace.primary, ['add', '--', 'src/data/api.js']);
    reservedGrant();

    const result = tryGit(workspace.primary, ['commit', '-m', 'feat: claude edit', '--no-verify'], {
      CLAUDECODE: '1',
      CODEX_THREAD_ID: '',
      CODEX_HOME: '',
      ORCA_TERMINAL_HANDLE: 'term_claude',
    });
    expect(result.status).toBe(0);
    const grant = readGrantFile(grantFilePath({ cwd: workspace.primary, terminalHandle: TERMINAL }));
    expect(grant.status).toBe('active');
  });
});
