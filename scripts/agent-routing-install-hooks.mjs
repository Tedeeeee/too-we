/**
 * 라우팅 훅을 모든 로컬 worktree에 설치한다.
 *
 *   node scripts/agent-routing-install-hooks.mjs [--hooks-dir <repo-relative-dir>]
 *
 * 버전 관리되는 `.githooks/` 템플릿을 공유 Git common 디렉터리 아래
 * `orca-routing-hooks/`로 복사하고, 공유 저장소의 `core.hooksPath`를 그 **절대** 경로로
 * 맞춘다.
 *
 * `core.hooksPath`를 `<primary>/.githooks`에 직접 두지 않는 이유: 그 경로는 작업 트리
 * 안이라서 `git rm .githooks/pre-commit` 한 커밋으로 훅 실행 자체를 없앨 수 있다. 배포된
 * 사본은 작업 트리 밖에 있으므로 어떤 커밋으로도 지워지지 않는다.
 *
 * Git worktree는 저장소 설정과 common 디렉터리를 공유하므로, 이 한 번의 설치로 기존
 * worktree와 앞으로 만들 worktree가 같은 훅을 쓴다.
 *
 * 설치는 여러 번 실행해도 안전하고, Git 메타데이터가 없는 소스 아카이브에서는 조용히
 * 건너뛴다(`npm install`의 postinstall을 깨뜨리지 않기 위한 것).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCommonDir, resolvePrimaryWorktree } from './agent-routing-grant.mjs';

const TEMPLATE_DIRNAME = '.githooks';
const DEPLOY_DIRNAME = 'orca-routing-hooks';
const USAGE = 'usage: node scripts/agent-routing-install-hooks.mjs [--hooks-dir <dir>]';

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Git Bash가 읽는 값이므로 슬래시로 저장한다. */
function toPosix(value) {
  return value.split(path.sep).join('/');
}

/** 훅이 실제로 실행되는 경로 — 작업 트리 밖이라 커밋으로 지울 수 없다. */
export function deployedHooksDir(cwd = process.cwd()) {
  return path.join(resolveCommonDir(cwd), DEPLOY_DIRNAME);
}

function readHooksPath(cwd) {
  try {
    return gitOut(cwd, ['config', '--get', 'core.hooksPath']);
  } catch {
    return '';
  }
}

function sameFile(a, b) {
  try {
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}

/** 임시 파일에 쓰고 rename — 반쯤 복사된 훅이 실행되는 창을 없앤다. */
function copyAtomic(source, target) {
  const temp = `${target}.tmp-${process.pid}`;
  fs.copyFileSync(source, temp);
  try {
    fs.chmodSync(temp, 0o755);
  } catch {
    // Windows는 실행 비트를 쓰지 않는다 — 설치를 실패시킬 이유가 아니다.
  }
  fs.renameSync(temp, target);
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
  let deployDir;
  try {
    primary = resolvePrimaryWorktree(cwd);
    deployDir = deployedHooksDir(cwd);
  } catch {
    log('[agent-routing] Git 메타데이터가 없어 훅 설치를 건너뛴다 (소스 아카이브로 보인다).');
    return 0;
  }

  const templateDir = path.resolve(primary, requestedDir ?? TEMPLATE_DIRNAME);
  let resolvedTemplate;
  try {
    resolvedTemplate = fs.realpathSync(templateDir);
  } catch {
    error(`[agent-routing] 훅 템플릿 디렉터리가 없다: ${templateDir}`);
    return 1;
  }
  if (!fs.statSync(resolvedTemplate).isDirectory()) {
    error(`[agent-routing] 훅 템플릿 경로가 디렉터리가 아니다: ${resolvedTemplate}`);
    return 1;
  }

  // 저장소 안에 있는 템플릿만 배포한다.
  const relative = path.relative(primary, resolvedTemplate);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    error(`[agent-routing] 훅 템플릿이 저장소(${primary}) 안에 없다: ${resolvedTemplate}`);
    return 1;
  }

  const templates = fs.readdirSync(resolvedTemplate, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  if (templates.length === 0) {
    error(`[agent-routing] 배포할 훅이 없다: ${resolvedTemplate}`);
    return 1;
  }

  let changed = false;
  try {
    fs.mkdirSync(deployDir, { recursive: true, mode: 0o700 });
    for (const name of templates) {
      const source = path.join(resolvedTemplate, name);
      const target = path.join(deployDir, name);
      if (sameFile(source, target)) continue;
      copyAtomic(source, target);
      changed = true;
    }
    // 템플릿에서 사라진 훅은 배포본에서도 없앤다 — 유령 훅이 남아 도는 것을 막는다.
    for (const entry of fs.readdirSync(deployDir, { withFileTypes: true })) {
      if (!entry.isFile() || templates.includes(entry.name)) continue;
      fs.rmSync(path.join(deployDir, entry.name), { force: true });
      changed = true;
    }
  } catch (cause) {
    error(`[agent-routing] 훅을 배포할 수 없다: ${String(cause.message ?? cause)}`);
    return 1;
  }

  const target = toPosix(deployDir);
  if (readHooksPath(primary) !== target) {
    try {
      gitOut(primary, ['config', 'core.hooksPath', target]);
    } catch (cause) {
      error(`[agent-routing] core.hooksPath를 설정할 수 없다: ${String(cause.message ?? cause)}`);
      return 1;
    }
    changed = true;
  }

  if (!changed) {
    log(`[agent-routing] 훅이 이미 설치돼 있다: ${target}`);
    return 0;
  }
  log(`[agent-routing] 훅 배포: ${templates.join(', ')} → ${target}`);
  log('[agent-routing] 모든 worktree가 같은 훅을 쓴다 (작업 트리 밖이라 커밋으로 지울 수 없다).');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runInstall({ argv: process.argv.slice(2) }));
}
