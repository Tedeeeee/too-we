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

/**
 * 세션 주체를 결정하는 Codex 세션 고유 표식.
 *
 * `CODEX_HOME`/`ORCA_CODEX_HOME`은 Orca가 모든 터미널에 물려주는 ambient 값이라 여기 없다.
 * 정책은 그 둘보다 이 표식을 우선하며(있으면 fail closed), 그것이 올바른 동작이다.
 */
export const SESSION_UNIQUE_CODEX_MARKERS = Object.freeze(['CODEX_THREAD_ID', 'CODEX_SESSION_ID']);

/**
 * 자식 프로세스에 넘길 밀폐된 환경을 만든다.
 *
 * 이 테스트들은 실제 `git commit`을 띄우므로 부모 환경을 물려받는다. 부모가 진짜 Codex
 * 세션이면 세션 고유 표식이 새어 들어와 "Claude 세션" fixture가 Codex로 판정되고, Claude
 * 허용 케이스가 부모 세션에 따라 결과를 바꾼다. 그래서 세션 고유 표식만 걷어낸다 —
 * ambient Codex 표식과 그 밖의 상속 환경(PATH 등)은 실제 작업자 조건이라 그대로 둔다.
 *
 * 명시적으로 요청한 값은 항상 이긴다. `CODEX_ENV`처럼 세션 고유 표식을 직접 넣으면 그대로
 * 남아 Codex로 판정된다. `null`을 주면 그 키를 지운다.
 *
 * @param {Record<string, string|null|undefined>} [overrides]
 * @param {Record<string, string|undefined>} [base] 부모 환경 (테스트 주입용)
 */
export function childEnv(overrides = {}, base = process.env) {
  const env = { ...base };
  for (const name of SESSION_UNIQUE_CODEX_MARKERS) delete env[name];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null || value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

/**
 * 이벤트 루프를 한 번 돌려준다(microtask가 아니라 macrotask).
 *
 * 라우팅 훅 테스트는 테스트마다 git·node 하위 프로세스를 십수 번 **동기로** 띄운다.
 * `await syncHelper()`는 microtask만 소비하므로 메시지 포트가 비워지지 않고, vitest worker가
 * `onTaskUpdate` RPC 응답을 처리할 틈을 얻지 못해 5초 타임아웃이 unhandled error로 올라온다.
 * 그러면 테스트가 전부 통과해도 종료 코드가 1이 되어 검증이 실패한다. 무거운 동기 구간
 * 사이에 이것을 한 번 넣어 끊어 준다.
 */
export function yieldToEventLoop() {
  return new Promise((resolve) => { setImmediate(resolve); });
}

export function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv(),
  }).trim();
}

/** 실패해도 던지지 않는 git 실행 — 훅이 커밋을 막는지 확인할 때 쓴다. */
export function tryGit(cwd, args, env = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: childEnv(env),
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
    env: childEnv(),
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
