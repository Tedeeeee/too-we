/**
 * 라우팅 가드 테스트용 임시 Git 저장소 헬퍼.
 *
 * 모든 테스트는 os.tmpdir() 아래에 폐기용 저장소를 만들고 끝나면 지운다. 개발자
 * 저장소나 사용자 설정을 절대 건드리지 않는다 — `core.hooksPath`를 없는 디렉터리로
 * 고정해 개발자 머신에 이미 설치된 훅이 테스트에 끼어들지 못하게 한다.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const INTEGRATION_BRANCH = 'codex/mvp-integration';
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 가드가 실제로 실행돼야 하는 파일들 — 훅 시나리오 테스트는 이 사본을 쓴다. */
const GUARD_FILES = [
  'scripts/agent-routing-policy.mjs',
  'scripts/agent-routing-grant.mjs',
  'scripts/verify-agent-routing.mjs',
  'scripts/agent-routing-install-hooks.mjs',
  '.githooks/pre-commit',
  '.githooks/post-commit',
  '.gitattributes',
];

export function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** 실패해도 던지지 않는 git 실행 — 훅이 커밋을 막는지 확인할 때 쓴다. */
export function tryGit(cwd, args, env = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    windowsHide: true,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** 실제 가드 파일을 임시 저장소로 복사하고 커밋한다. */
export function installGuardFiles(primary) {
  for (const relativePath of GUARD_FILES) {
    const source = path.join(REPO_ROOT, relativePath);
    const target = path.join(primary, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    if (relativePath.startsWith('.githooks/')) fs.chmodSync(target, 0o755);
  }
  git(primary, ['add', '--', ...GUARD_FILES]);
  git(primary, ['commit', '-q', '-m', 'install guard fixture', '--no-verify']);
}

/** 통합 브랜치에 커밋 하나가 있는 기본 저장소를 만든다. */
export function makeWorkspace({ branch = INTEGRATION_BRANCH } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-routing-')));
  const primary = path.join(root, 'primary');
  fs.mkdirSync(primary);
  git(primary, ['init', '-q', '-b', branch]);
  git(primary, ['config', 'user.email', 'guard@example.test']);
  git(primary, ['config', 'user.name', 'Guard Test']);
  git(primary, ['config', 'commit.gpgsign', 'false']);
  // Windows 개발 환경과 같은 조건으로 고정한다 — 훅이 CRLF로 체크아웃되는지 실제로 검증하려면
  // 플랫폼에 상관없이 정규화가 켜져 있어야 한다.
  git(primary, ['config', 'core.autocrlf', 'true']);
  git(primary, ['config', 'core.hooksPath', path.join(root, 'absent-hooks')]);
  writeFile(primary, 'README.md', '# fixture\n');
  git(primary, ['add', 'README.md']);
  git(primary, ['commit', '-q', '-m', 'seed', '--no-verify']);
  return { root, primary };
}

export function addWorktree({ root, primary }, name, branch) {
  const dir = path.join(root, name);
  git(primary, ['worktree', 'add', '-q', '-b', branch, dir]);
  return fs.realpathSync(dir);
}

/** 새 clone을 만든다 — 훅이 어떤 줄바꿈으로 체크아웃되는지 확인하는 데 쓴다. */
export function makeClone({ root, primary }, name) {
  const dir = path.join(root, name);
  execFileSync('git', ['clone', '-q', '--no-hardlinks', '-c', 'core.autocrlf=true', primary, dir], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  git(dir, ['config', 'user.email', 'guard@example.test']);
  git(dir, ['config', 'user.name', 'Guard Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.autocrlf', 'true']);
  return fs.realpathSync(dir);
}

export function writeFile(dir, relativePath, contents) {
  const target = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

export function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

/** 성공하는 Orca 스텁 — 실제 CLI의 출력 형태를 그대로 흉내낸다. */
export function orcaStub({
  dispatchId,
  taskId,
  terminalHandle,
  status = 'dispatched',
  runId = 'run_85aff4ff9daf',
  coordinatorHandle = 'term_1a050ae1-f664-434f-a545-0ea73728d5ed',
}) {
  const calls = [];
  return {
    calls,
    dispatchShow(requestedTask) {
      calls.push(`dispatch-show:${requestedTask}`);
      return {
        status: 0,
        stdout: JSON.stringify({
          result: {
            dispatch: {
              id: dispatchId,
              task_id: taskId,
              run_id: runId,
              status,
              assignee_handle: terminalHandle,
            },
          },
        }),
      };
    },
    runShow(requestedRun) {
      calls.push(`run-show:${requestedRun}`);
      return {
        status: 0,
        stdout: JSON.stringify({
          result: { run: { id: runId, status: 'active', coordinator_handle: coordinatorHandle } },
        }),
      };
    },
  };
}
