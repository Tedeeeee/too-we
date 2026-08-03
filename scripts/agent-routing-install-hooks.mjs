/**
 * 라우팅 훅을 모든 로컬 worktree에 설치한다.
 *
 *   node scripts/agent-routing-install-hooks.mjs
 *
 * 인자를 받지 않는다. 템플릿은 항상 정확히 주 worktree의 `.githooks/pre-commit`과
 * `.githooks/post-commit`이며, 둘 다 Git이 추적하는 일반 파일이고 HEAD 기준으로 staged·
 * unstaged 변경이 없어야 배포된다. 경로를 바꾸는 플래그나 디렉터리 훑기를 허용하면
 * 저장소 안에 커밋해 둔 임의 스크립트를 훅으로 배포할 수 있다.
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
const USAGE = 'usage: node scripts/agent-routing-install-hooks.mjs';

/**
 * 배포하는 훅은 정확히 이 둘이다.
 *
 * 디렉터리를 훑어 "있는 것을 전부" 배포하지 않는다. 템플릿 경로를 바꾸는 플래그도 두지
 * 않는다 — 둘 중 하나라도 열려 있으면 저장소 안에 커밋해 둔 임의 스크립트를 훅으로
 * 배포할 수 있다.
 */
const REQUIRED_HOOKS = Object.freeze(['pre-commit', 'post-commit']);

/**
 * 훅과 함께 배포하는 런타임 소스 — 검증기와 그 import 폐쇄집합 전체.
 *
 * 훅이 작업 트리의 `scripts/`를 실행하면 Codex가 그 파일을 고쳐(검증기를 `process.exit(0)`으로,
 * 정책의 `classifyAgent`를 항상 claude로, grant 모듈이 grant를 위조하도록) 같은 커밋에서 가드를
 * 무력화할 수 있다. 그래서 세 파일을 훅 옆에 복사한다. 셋 다 서로를 `./`로 import하므로 배포
 * 디렉터리 안에서 해석이 닫히고, 작업 트리 쪽은 런타임에 전혀 읽히지 않는다.
 */
const RUNTIME_SOURCE_DIRNAME = 'scripts';
const RUNTIME_SOURCES = Object.freeze([
  'verify-agent-routing.mjs',
  'agent-routing-grant.mjs',
  'agent-routing-policy.mjs',
]);

/** 배포 디렉터리에 있어야 하는 파일 전체. 이 목록 밖의 파일은 지운다. */
const DEPLOYED_FILES = Object.freeze([...REQUIRED_HOOKS, ...RUNTIME_SOURCES]);

/**
 * 배포 대상 목록. 이름은 두 집합에서 겹치지 않으므로 배포 디렉터리에서 평평하게 놓인다.
 *
 * @returns {{ name: string, relative: string, absolute: string }[]}
 */
function baselineEntries(primary) {
  const entry = (dirname, name) => ({
    name,
    relative: `${dirname}/${name}`,
    absolute: path.join(primary, dirname, name),
  });
  return [
    ...REQUIRED_HOOKS.map((name) => entry(TEMPLATE_DIRNAME, name)),
    ...RUNTIME_SOURCES.map((name) => entry(RUNTIME_SOURCE_DIRNAME, name)),
  ];
}

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

function gitLines(cwd, args) {
  return gitOut(cwd, args).split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
}

/**
 * 템플릿이 "커밋된 깨끗한 baseline"인지 확인한다.
 *
 * 배포 대상은 리뷰를 통과해 커밋된 내용이어야 한다. 파일이 없거나, 일반 파일이 아니거나,
 * Git이 추적하지 않거나, HEAD 기준으로 staged·unstaged 변경이 남아 있으면 배포하지 않는다
 * (fail closed). 이 검사가 없으면 커밋하지 않은 훅을 배포해 가드를 조용히 바꿀 수 있다.
 *
 * Git 상태는 반드시 주 worktree에서 조회한다 — 자식 worktree의 index·HEAD를 보면 안 된다.
 *
 * @returns {string[]} 문제 설명 목록. 비어 있으면 배포해도 된다.
 */
function validateBaseline({ primary, entries }) {
  const problems = [];
  for (const { relative, absolute } of entries) {
    let stat;
    try {
      stat = fs.lstatSync(absolute);
    } catch {
      problems.push(`${relative} 이 없다`);
      continue;
    }
    // lstat이므로 심볼릭 링크는 일반 파일로 인정되지 않는다.
    if (!stat.isFile()) {
      problems.push(`${relative} 이 일반 파일이 아니다`);
      continue;
    }
    // 상위 디렉터리가 심볼릭 링크로 바뀌어 저장소 밖을 가리키는 경우를 막는다.
    if (path.relative(primary, fs.realpathSync(absolute)) !== relative.split('/').join(path.sep)) {
      problems.push(`${relative} 이 주 worktree 안의 같은 경로가 아니다`);
      continue;
    }

    let tracked;
    let staged;
    let unstaged;
    try {
      tracked = gitLines(primary, ['ls-files', '--', relative]).length > 0;
      staged = gitLines(primary, ['diff', '--cached', '--name-only', 'HEAD', '--', relative]).length > 0;
      unstaged = gitLines(primary, ['diff', '--name-only', '--', relative]).length > 0;
    } catch {
      problems.push(`${relative} 의 Git 상태를 확인할 수 없다`);
      continue;
    }
    if (!tracked) {
      problems.push(`${relative} 이 Git에 추적되지 않는다 — 커밋된 baseline만 배포한다`);
      continue;
    }
    if (staged) {
      problems.push(`${relative} 에 커밋되지 않은 staged 변경이 있다`);
      continue;
    }
    if (unstaged) {
      problems.push(`${relative} 에 커밋되지 않은 unstaged 변경이 있다`);
    }
  }
  return problems;
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

  // 인자를 하나도 받지 않는다. 템플릿 경로는 항상 정확히 primary/.githooks다.
  if (argv.length > 0) {
    error(`[agent-routing] 이 명령은 인자를 받지 않는다: ${argv[0]}`);
    error('[agent-routing] 훅 템플릿은 항상 주 worktree의 .githooks/ 이며 바꿀 수 없다.');
    error(USAGE);
    return 1;
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

  const templateDir = path.join(primary, TEMPLATE_DIRNAME);
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

  // `.githooks`가 저장소 밖을 가리키는 심볼릭 링크로 바뀐 경우를 막는다.
  const insideRepo = path.relative(primary, resolvedTemplate);
  if (insideRepo !== TEMPLATE_DIRNAME) {
    error(`[agent-routing] 훅 템플릿이 주 worktree의 ${TEMPLATE_DIRNAME}/ 가 아니다: ${resolvedTemplate}`);
    return 1;
  }

  // 검사를 모두 통과하기 전에는 아무것도 배포하지 않는다.
  const entries = baselineEntries(primary);
  const problems = validateBaseline({ primary, entries });
  if (problems.length > 0) {
    error('[agent-routing] 훅과 런타임 소스가 커밋된 깨끗한 baseline이 아니라 설치하지 않는다.');
    for (const problem of problems) error(`  - ${problem}`);
    error('[agent-routing] 파일을 되돌리거나 커밋한 뒤 다시 설치한다.');
    return 1;
  }

  let changed = false;
  try {
    fs.mkdirSync(deployDir, { recursive: true, mode: 0o700 });
    for (const { name, absolute } of entries) {
      const target = path.join(deployDir, name);
      if (sameFile(absolute, target)) continue;
      copyAtomic(absolute, target);
      changed = true;
    }
    // 배포 대상이 아닌 파일은 없앤다 — 유령 훅이나 낡은 런타임이 남아 도는 것을 막는다.
    for (const entry of fs.readdirSync(deployDir, { withFileTypes: true })) {
      if (!entry.isFile() || DEPLOYED_FILES.includes(entry.name)) continue;
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
  log(`[agent-routing] 배포: ${DEPLOYED_FILES.join(', ')} → ${target}`);
  log('[agent-routing] 모든 worktree가 이 사본을 쓴다 (작업 트리 밖이라 커밋으로 바꿀 수 없다).');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runInstall({ argv: process.argv.slice(2) }));
}
