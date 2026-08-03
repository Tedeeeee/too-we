/**
 * 라우팅 훅을 모든 로컬 worktree에 설치한다.
 *
 *   node scripts/install-agent-routing-hooks.mjs [--hooks-dir <repo-relative-dir>]
 *
 * 공유 저장소의 `core.hooksPath`를 주 worktree의 **절대** `.githooks` 경로로 맞춘다.
 * Git worktree는 저장소 설정을 공유하므로, 이 한 번의 설정으로 기존 worktree와 앞으로
 * 만들 worktree가 같은 훅을 쓴다. 자식 worktree가 훅 파일이 없는 오래된 브랜치를 보고
 * 있어도 훅은 주 worktree에서 읽히므로 정책이 빠지지 않는다.
 *
 * 설치는 여러 번 실행해도 안전하고, Git 메타데이터가 없는 소스 아카이브에서는 조용히
 * 건너뛴다(`npm install`의 postinstall을 깨뜨리지 않기 위한 것).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePrimaryWorktree } from './agent-routing-grant.mjs';

const DEFAULT_HOOKS_DIRNAME = '.githooks';
const USAGE = 'usage: node scripts/install-agent-routing-hooks.mjs [--hooks-dir <dir>]';

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Git Bash가 읽는 값이므로 슬래시로 저장한다. */
function toPosix(value) {
  return value.split(path.sep).join('/');
}

function readHooksPath(cwd) {
  try {
    return gitOut(cwd, ['config', '--get', 'core.hooksPath']);
  } catch {
    return '';
  }
}

/**
 * @param {object} [options]
 * @returns {number} 프로세스 종료 코드
 */
export function runInstall(options = {}) {
  const { argv = [], cwd = process.cwd(), log = console.log, error = console.error } = options;

  let requestedDir = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--hooks-dir') {
      error(`허용되지 않은 플래그: ${argv[i]}`);
      error(USAGE);
      return 1;
    }
    requestedDir = argv[i + 1];
    i += 1;
    if (!requestedDir) {
      error('--hooks-dir 값이 없다');
      return 1;
    }
  }

  let primary;
  try {
    primary = resolvePrimaryWorktree(cwd);
  } catch {
    log('[agent-routing] Git 메타데이터가 없어 훅 설치를 건너뛴다 (소스 아카이브로 보인다).');
    return 0;
  }

  const hooksDir = path.resolve(primary, requestedDir ?? DEFAULT_HOOKS_DIRNAME);

  let resolved;
  try {
    resolved = fs.realpathSync(hooksDir);
  } catch {
    error(`[agent-routing] 훅 디렉터리가 없다: ${hooksDir}`);
    return 1;
  }
  if (!fs.statSync(resolved).isDirectory()) {
    error(`[agent-routing] 훅 경로가 디렉터리가 아니다: ${resolved}`);
    return 1;
  }

  // 저장소 안에 있는지 확인한 뒤에만 Git 설정을 바꾼다.
  const relative = path.relative(primary, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    error(`[agent-routing] 훅 디렉터리가 저장소(${primary}) 안에 없다: ${resolved}`);
    return 1;
  }

  const target = toPosix(resolved);
  if (readHooksPath(primary) === target) {
    log(`[agent-routing] 훅이 이미 설치돼 있다: ${target}`);
    return 0;
  }

  try {
    gitOut(primary, ['config', 'core.hooksPath', target]);
  } catch (cause) {
    error(`[agent-routing] core.hooksPath를 설정할 수 없다: ${String(cause.message ?? cause)}`);
    return 1;
  }

  // POSIX에서 실행 권한이 빠져 있으면 Git이 훅을 건너뛴다.
  for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    try {
      fs.chmodSync(path.join(resolved, entry.name), 0o755);
    } catch {
      // Windows는 실행 비트를 쓰지 않는다 — 설치를 실패시킬 이유가 아니다.
    }
  }

  log(`[agent-routing] core.hooksPath = ${target}`);
  log('[agent-routing] 이 저장소의 모든 worktree가 같은 훅을 사용한다.');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runInstall({ argv: process.argv.slice(2) }));
}
