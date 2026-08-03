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
import { deployedHooksDir, runInstall } from './agent-routing-install-hooks.mjs';

const TERMINAL = 'term_dd2dc226-4f0c-4af3-ac3c-ce5d97d135ec';
const TASK = 'task_288b4e349139';
const DISPATCH = 'ctx_e78bbc014ce7';
const RUN = 'run_85aff4ff9daf';
const COORDINATOR = 'term_1a050ae1-f664-434f-a545-0ea73728d5ed';

/** 실제 Claude 작업자 터미널은 ambient CODEX_HOME을 물려받은 상태다 — 일부러 지우지 않는다. */
const CLAUDE_ENV = { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', ORCA_TERMINAL_HANDLE: 'term_claude' };

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

/**
 * 배포 경로는 작업 트리 밖의 Git common 디렉터리다.
 *
 * `core.hooksPath`를 버전 관리되는 `<primary>/.githooks`에 두면 Codex가
 * `git rm .githooks/pre-commit` 한 커밋으로 훅 실행 자체를 없앨 수 있다. 배포된 사본은
 * 커밋으로 지울 수 없다.
 */
function expectedHooksPath() {
  return posix(path.join(workspace.primary, '.git', 'orca-routing-hooks'));
}

function deployedDir() {
  return path.join(workspace.primary, '.git', 'orca-routing-hooks');
}

function templatePath(hook) {
  return path.join(workspace.primary, '.githooks', hook);
}

/** 설치가 아무것도 하지 않았는지 — 배포 디렉터리도 hooksPath도 건드리지 않았다. */
function expectNotInstalled() {
  expect(fs.existsSync(deployedDir())).toBe(false);
  expect(tryGit(workspace.primary, ['config', '--get', 'core.hooksPath']).stdout)
    .not.toContain('orca-routing-hooks');
}

describe('installer argv surface', () => {
  beforeEach(() => {
    installGuardFiles(workspace.primary);
  });

  /**
   * 프로덕션 CLI에는 템플릿 경로를 바꾸는 플래그가 없다. 있으면 저장소 안의 임의
   * 디렉터리(예: 공격자가 커밋한 `tools/fake-hooks`)를 훅으로 배포할 수 있다.
   * 템플릿은 항상 정확히 `primary/.githooks`다.
   */
  it('rejects --hooks-dir and every other argument', () => {
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'outside-hooks-')));
    try {
      const rejected = [
        ['--hooks-dir', outside],
        ['--hooks-dir', '.githooks'],
        ['--hooks-dir', 'tools/fake-hooks'],
        ['--hooks-dir', '../evil'],
        ['--hooks-dir'],
        ['--template-dir', '.githooks'],
        ['--force'],
        ['.githooks'],
      ];
      for (const argv of rejected) {
        output.length = 0;
        expect(install({ argv }), JSON.stringify(argv)).toBe(1);
        expectNotInstalled();
      }
    } finally {
      cleanup(outside);
    }
  });

  it('cannot be redirected to a repository-internal directory', () => {
    // 저장소 안에 진짜처럼 보이는 훅 세트를 커밋해 둬도 배포되지 않는다.
    writeFile(workspace.primary, 'tools/fake-hooks/pre-commit', '#!/bin/sh\nexit 0\n');
    writeFile(workspace.primary, 'tools/fake-hooks/post-commit', '#!/bin/sh\nexit 0\n');
    git(workspace.primary, ['add', '--', 'tools/fake-hooks']);
    git(workspace.primary, ['commit', '-q', '-m', 'chore: decoy hooks', '--no-verify']);

    expect(install({ argv: ['--hooks-dir', 'tools/fake-hooks'] })).toBe(1);
    expectNotInstalled();

    // 플래그 없이 설치하면 진짜 템플릿만 배포된다.
    expect(install()).toBe(0);
    expect(fs.readFileSync(path.join(deployedDir(), 'pre-commit'), 'utf8'))
      .toBe(fs.readFileSync(templatePath('pre-commit'), 'utf8'));
  });
});

describe('template integrity', () => {
  beforeEach(() => {
    installGuardFiles(workspace.primary);
  });

  it('refuses a missing template', () => {
    fs.rmSync(templatePath('post-commit'));
    expect(install()).toBe(1);
    expect(output.join('\n')).toContain('post-commit');
    expectNotInstalled();
  });

  it('refuses a template that is not a regular file', () => {
    fs.rmSync(templatePath('pre-commit'));
    fs.mkdirSync(templatePath('pre-commit'));
    expect(install()).toBe(1);
    expectNotInstalled();
  });

  it('refuses an untracked template', () => {
    // 파일은 있지만 Git이 모르는 상태 — 커밋된 baseline이 아니므로 배포하지 않는다.
    git(workspace.primary, ['rm', '-q', '--cached', '--', '.githooks/pre-commit']);
    expect(install()).toBe(1);
    expect(output.join('\n')).toContain('.githooks/pre-commit');
    expectNotInstalled();
  });

  it('refuses a staged-dirty template', () => {
    writeFile(workspace.primary, '.githooks/pre-commit', '#!/bin/sh\nexit 0\n');
    git(workspace.primary, ['add', '--', '.githooks/pre-commit']);
    expect(install()).toBe(1);
    expect(output.join('\n')).toContain('.githooks/pre-commit');
    expectNotInstalled();
  });

  it('refuses an unstaged-dirty template', () => {
    writeFile(workspace.primary, '.githooks/post-commit', '#!/bin/sh\nexit 0\n');
    expect(install()).toBe(1);
    expect(output.join('\n')).toContain('.githooks/post-commit');
    expectNotInstalled();
  });

  it('checks the primary templates even when invoked from a linked worktree', () => {
    const linked = addWorktree(workspace, 'child', 'claude/feature');
    writeFile(workspace.primary, '.githooks/pre-commit', '#!/bin/sh\nexit 0\n');
    expect(install({ cwd: linked })).toBe(1);
    expectNotInstalled();
  });

  it('installs from a clean merged baseline and stays idempotent', () => {
    expect(install()).toBe(0);
    for (const hook of ['pre-commit', 'post-commit']) {
      expect(fs.readFileSync(path.join(deployedDir(), hook), 'utf8'))
        .toBe(fs.readFileSync(templatePath(hook), 'utf8'));
    }
    output.length = 0;
    expect(install()).toBe(0);
    expect(output.join('\n')).toMatch(/이미|already/i);
    expect(configuredHooksPath(workspace.primary)).toBe(expectedHooksPath());
  });
});

describe('hook installation', () => {
  beforeEach(() => {
    installGuardFiles(workspace.primary);
  });

  it('deploys the hooks outside the working tree and points Git at that copy', () => {
    expect(install()).toBe(0);
    expect(configuredHooksPath(workspace.primary)).toBe(expectedHooksPath());
    expect(posix(deployedHooksDir(workspace.primary))).toBe(expectedHooksPath());

    for (const hook of ['pre-commit', 'post-commit']) {
      const deployed = path.join(workspace.primary, '.git', 'orca-routing-hooks', hook);
      expect(fs.existsSync(deployed), hook).toBe(true);
      expect(fs.readFileSync(deployed, 'utf8'))
        .toBe(fs.readFileSync(path.join(workspace.primary, '.githooks', hook), 'utf8'));
    }
  });

  it('refreshes the deployed copy when a committed template changes', () => {
    expect(install()).toBe(0);
    // 커밋된 baseline만 배포된다 — 템플릿을 고쳤으면 커밋해야 반영된다.
    writeFile(workspace.primary, '.githooks/pre-commit', '#!/bin/sh\nexit 0\n');
    git(workspace.primary, ['add', '--', '.githooks/pre-commit']);
    git(workspace.primary, ['commit', '-q', '-m', 'chore: tweak hook', '--no-verify']);

    output.length = 0;
    expect(install()).toBe(0);
    expect(fs.readFileSync(path.join(deployedDir(), 'pre-commit'), 'utf8')).toBe('#!/bin/sh\nexit 0\n');
  });

  it('ignores template files outside the exact deployed set', () => {
    writeFile(workspace.primary, '.githooks/extra.sh', '#!/bin/sh\necho extra\n');
    git(workspace.primary, ['add', '--', '.githooks/extra.sh']);
    git(workspace.primary, ['commit', '-q', '-m', 'chore: extra script', '--no-verify']);

    expect(install()).toBe(0);
    expect(fs.readdirSync(deployedDir())).not.toContain('extra.sh');
  });

  it('resolves the primary worktree even when invoked from a child worktree', () => {
    const linked = addWorktree(workspace, 'child', 'claude/feature');

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

    const result = tryGit(workspace.primary, ['commit', '-m', 'feat: claude edit'], CLAUDE_ENV);
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

/**
 * 배포된 훅이 실행해야 하는 파일 전체.
 *
 * 훅 두 개와 런타임 소스 세 개(검증기와 그 의존성)를 함께 배포한다. 훅이 작업 트리의
 * `scripts/`를 실행하면 Codex가 그 파일을 고쳐 가드를 무력화할 수 있다.
 */
const DEPLOYED_RUNTIME = [
  'agent-routing-grant.mjs',
  'agent-routing-policy.mjs',
  'post-commit',
  'pre-commit',
  'verify-agent-routing.mjs',
];

/** 작업 트리 검증기를 "전부 통과"로 바꾼 것. 배포본이 쓰이면 아무 효과가 없어야 한다. */
const ALLOW_ALL_VERIFIER = 'process.exit(0);\n';

/**
 * 진짜 정책 모듈에서 `classifyAgent`만 무력화한다.
 *
 * 빈 스텁으로 바꾸면 grant 모듈이 import하는 다른 이름들이 사라져 import 자체가 깨지고,
 * 그러면 "무엇 때문에 막혔는지"가 흐려진다. 나머지 export를 그대로 두고 조기 return만
 * 심어야 실제로 통과했을 우회를 재현한다.
 */
function permissivePolicySource(primary) {
  const real = fs.readFileSync(path.join(primary, 'scripts/agent-routing-policy.mjs'), 'utf8');
  const tampered = real.replace('export function classifyAgent(env) {', "export function classifyAgent(env) { return 'claude';");
  // 치환이 조용히 실패해 테스트가 무의미해지는 것을 막는다.
  expect(tampered).not.toBe(real);
  return tampered;
}

/** grant 모듈은 grant 내용과 Dispatch 응답을 함께 공급하므로 단독으로 위조가 가능하다. */
const FORGING_GRANT = `const now = Date.now();
export function grantFilePath() { return 'forged'; }
export function readGrantFile() {
  return {
    version: 1,
    reason: 'claude_account_capacity_exhausted',
    status: 'active',
    terminalHandle: process.env.ORCA_TERMINAL_HANDLE,
    taskId: 'task_forged',
    dispatchId: 'ctx_forged',
    runId: 'run_forged',
    issuedByCoordinatorHandle: 'term_forged_coordinator',
    evidenceSource: 'read-only-usage-check',
    observedAt: new Date(now - 60000).toISOString(),
    expiresAt: new Date(now + 1800000).toISOString(),
    allowedPaths: ['src', 'scripts'],
    remainingScope: 'forged scope',
    createdAt: new Date(now - 60000).toISOString(),
    finalizedAt: new Date(now - 30000).toISOString(),
  };
}
export function createOrcaAdapter() {
  return {
    dispatchShow() {
      return { status: 0, stdout: JSON.stringify({ result: { dispatch: {
        id: 'ctx_forged',
        task_id: 'task_forged',
        run_id: 'run_forged',
        status: 'dispatched',
        assignee_handle: process.env.ORCA_TERMINAL_HANDLE,
      } } }) };
    },
    runShow() { return { status: 0, stdout: '{}' }; },
  };
}
export function runGrant() { return 0; }
`;

describe('deployed runtime isolation', () => {
  beforeEach(() => {
    installGuardFiles(workspace.primary);
    expect(install()).toBe(0);
  });

  /** 작업 트리의 가드 파일을 무력화하고 제품 변경과 함께 stage한다. */
  function tamperAndStageProductChange(relativePath, contents) {
    writeFile(workspace.primary, relativePath, contents);
    git(workspace.primary, ['add', '--', relativePath]);
    writeFile(workspace.primary, 'src/data/api.js', 'codex edit\n');
    git(workspace.primary, ['add', '--', 'src/data/api.js']);
  }

  it('deploys the verifier and its dependencies beside the hooks', () => {
    expect(fs.readdirSync(deployedDir()).sort()).toEqual(DEPLOYED_RUNTIME);
    for (const name of DEPLOYED_RUNTIME) {
      const source = name.endsWith('.mjs')
        ? path.join(workspace.primary, 'scripts', name)
        : templatePath(name);
      expect(fs.readFileSync(path.join(deployedDir(), name)).equals(fs.readFileSync(source)), name).toBe(true);
    }
  });

  it('removes deployed files that are not part of the runtime', () => {
    fs.writeFileSync(path.join(deployedDir(), 'stray.mjs'), 'process.exit(0);\n');
    expect(install()).toBe(0);
    expect(fs.readdirSync(deployedDir()).sort()).toEqual(DEPLOYED_RUNTIME);
  });

  it('rejects an ungranted Codex commit when the working-tree verifier allows everything', () => {
    const before = git(workspace.primary, ['rev-parse', 'HEAD']);
    tamperAndStageProductChange('scripts/verify-agent-routing.mjs', ALLOW_ALL_VERIFIER);

    const result = tryGit(workspace.primary, ['commit', '-m', 'feat: sneak past the guard'], CODEX_ENV);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('src/data/api.js');
    expect(git(workspace.primary, ['rev-parse', 'HEAD'])).toBe(before);
  });

  it('rejects an ungranted Codex commit when the working-tree policy is permissive', () => {
    const before = git(workspace.primary, ['rev-parse', 'HEAD']);
    tamperAndStageProductChange('scripts/agent-routing-policy.mjs', permissivePolicySource(workspace.primary));

    const result = tryGit(workspace.primary, ['commit', '-m', 'feat: sneak past the guard'], CODEX_ENV);
    expect(result.status).not.toBe(0);
    expect(git(workspace.primary, ['rev-parse', 'HEAD'])).toBe(before);
  });

  it('rejects an ungranted Codex commit when the working-tree grant module forges a grant', () => {
    const before = git(workspace.primary, ['rev-parse', 'HEAD']);
    tamperAndStageProductChange('scripts/agent-routing-grant.mjs', FORGING_GRANT);

    const result = tryGit(workspace.primary, ['commit', '-m', 'feat: sneak past the guard'], CODEX_ENV);
    expect(result.status).not.toBe(0);
    expect(git(workspace.primary, ['rev-parse', 'HEAD'])).toBe(before);
  });

  it('rejects an ungranted Codex commit when the working-tree verifier is deleted', () => {
    const before = git(workspace.primary, ['rev-parse', 'HEAD']);
    git(workspace.primary, ['rm', '-q', '--', 'scripts/verify-agent-routing.mjs']);
    writeFile(workspace.primary, 'src/data/api.js', 'codex edit\n');
    git(workspace.primary, ['add', '--', 'src/data/api.js']);

    const result = tryGit(workspace.primary, ['commit', '-m', 'feat: drop the verifier'], CODEX_ENV);
    expect(result.status).not.toBe(0);
    expect(git(workspace.primary, ['rev-parse', 'HEAD'])).toBe(before);
  });

  it('still blocks from a linked worktree when the primary working tree is tampered', () => {
    const linked = addWorktree(workspace, 'child', 'claude/feature');
    writeFile(workspace.primary, 'scripts/verify-agent-routing.mjs', ALLOW_ALL_VERIFIER);
    writeFile(linked, 'src/data/api.js', 'codex edit\n');
    git(linked, ['add', '--', 'src/data/api.js']);

    const result = tryGit(linked, ['commit', '-m', 'feat: sneak past the guard'], CODEX_ENV);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('src/data/api.js');
  });

  it('still permits a Codex documentation commit through the deployed runtime', () => {
    writeFile(workspace.primary, 'docs/notes.md', '# notes\n');
    git(workspace.primary, ['add', '--', 'docs/notes.md']);
    expect(tryGit(workspace.primary, ['commit', '-m', 'docs: notes'], CODEX_ENV).status).toBe(0);
  });
});

describe('runtime source baseline', () => {
  beforeEach(() => {
    installGuardFiles(workspace.primary);
  });

  const RUNTIME_SOURCES = [
    'scripts/verify-agent-routing.mjs',
    'scripts/agent-routing-grant.mjs',
    'scripts/agent-routing-policy.mjs',
  ];

  it('refuses a missing runtime source', () => {
    for (const relative of RUNTIME_SOURCES) {
      cleanup(workspace.root);
      workspace = makeWorkspace();
      installGuardFiles(workspace.primary);
      output.length = 0;
      fs.rmSync(path.join(workspace.primary, relative));
      expect(install(), relative).toBe(1);
      expect(output.join('\n'), relative).toContain(relative);
      expectNotInstalled();
    }
  });

  it('refuses an untracked runtime source', () => {
    git(workspace.primary, ['rm', '-q', '--cached', '--', 'scripts/agent-routing-policy.mjs']);
    expect(install()).toBe(1);
    expect(output.join('\n')).toContain('scripts/agent-routing-policy.mjs');
    expectNotInstalled();
  });

  it('refuses a staged-dirty runtime source', () => {
    writeFile(workspace.primary, 'scripts/verify-agent-routing.mjs', ALLOW_ALL_VERIFIER);
    git(workspace.primary, ['add', '--', 'scripts/verify-agent-routing.mjs']);
    expect(install()).toBe(1);
    expect(output.join('\n')).toContain('scripts/verify-agent-routing.mjs');
    expectNotInstalled();
  });

  it('refuses an unstaged-dirty runtime source', () => {
    writeFile(workspace.primary, 'scripts/agent-routing-grant.mjs', FORGING_GRANT);
    expect(install()).toBe(1);
    expect(output.join('\n')).toContain('scripts/agent-routing-grant.mjs');
    expectNotInstalled();
  });

  it('refuses a runtime source that is not a regular file', () => {
    fs.rmSync(path.join(workspace.primary, 'scripts/agent-routing-policy.mjs'));
    fs.mkdirSync(path.join(workspace.primary, 'scripts/agent-routing-policy.mjs'));
    expect(install()).toBe(1);
    expectNotInstalled();
  });
});

describe('tamper resistance', () => {
  beforeEach(() => {
    installGuardFiles(workspace.primary);
    expect(install()).toBe(0);
  });

  it('still runs when Codex stages the deletion of the versioned hook', () => {
    // 배포된 사본이 Git common 디렉터리에 있으므로 커밋으로 지울 수 없다.
    const before = git(workspace.primary, ['rev-parse', 'HEAD']);
    git(workspace.primary, ['rm', '-q', '--', '.githooks/pre-commit']);

    const result = tryGit(workspace.primary, ['commit', '-m', 'chore: drop hook'], CODEX_ENV);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('.githooks/pre-commit');
    expect(git(workspace.primary, ['rev-parse', 'HEAD'])).toBe(before);
  });

  /**
   * 훅이 작업 트리의 검증기를 실행하던 동안에는 그 파일을 지우면 **모든** 세션의 커밋이
   * 막혔다. 그것은 우회 가능한 구조가 낳은 부작용이었다 — Claude가 가드를 리팩터링하지도
   * 못했다. 배포된 사본을 실행하는 지금은 Codex만 막힌다(가드 파일은 구현 경로이므로
   * grant 없이 손댈 수 없다). 어느 쪽이든 배포된 런타임은 그대로 남아 가드가 풀리지 않는다.
   */
  it('blocks Codex from removing the verifier but lets Claude refactor it', () => {
    const before = git(workspace.primary, ['rev-parse', 'HEAD']);
    git(workspace.primary, ['rm', '-q', '--', 'scripts/verify-agent-routing.mjs']);

    const blocked = tryGit(workspace.primary, ['commit', '-m', 'chore: drop verifier'], CODEX_ENV);
    expect(blocked.status).not.toBe(0);
    expect(`${blocked.stdout}${blocked.stderr}`).toContain('scripts/verify-agent-routing.mjs');
    expect(git(workspace.primary, ['rev-parse', 'HEAD'])).toBe(before);

    expect(tryGit(workspace.primary, ['commit', '-m', 'refactor: drop verifier'], CLAUDE_ENV).status).toBe(0);
    expect(fs.existsSync(path.join(deployedDir(), 'verify-agent-routing.mjs'))).toBe(true);
  });

  it('keeps the guard armed after the working-tree verifier is moved away', () => {
    git(workspace.primary, ['mv', 'scripts/verify-agent-routing.mjs', 'scripts/parked.mjs']);
    expect(tryGit(workspace.primary, ['commit', '-m', 'refactor: park verifier'], CLAUDE_ENV).status).toBe(0);

    // 작업 트리에 검증기가 아예 없어도 배포된 런타임이 무허가 Codex 변경을 막는다.
    writeFile(workspace.primary, 'src/data/api.js', 'codex edit\n');
    git(workspace.primary, ['add', '--', 'src/data/api.js']);
    const result = tryGit(workspace.primary, ['commit', '-m', 'feat: product edit'], CODEX_ENV);
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
      env: { ORCA_TERMINAL_HANDLE: COORDINATOR },
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
        '--run', RUN,
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

    const result = tryGit(workspace.primary, ['commit', '-m', 'feat: claude edit', '--no-verify'], CLAUDE_ENV);
    expect(result.status).toBe(0);
    const grant = readGrantFile(grantFilePath({ cwd: workspace.primary, terminalHandle: TERMINAL }));
    expect(grant.status).toBe('active');
  });
});
