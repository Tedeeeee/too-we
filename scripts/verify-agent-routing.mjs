/**
 * 구현 작업자 라우팅 검증 — 테스트·빌드·pre-commit이 모두 이 하나를 부른다.
 *
 *   node scripts/verify-agent-routing.mjs            # working tree (staged + unstaged + untracked)
 *   node scripts/verify-agent-routing.mjs --staged   # index만 (pre-commit)
 *
 * Claude, 사람, 그리고 조정자 문서만 바꾸는 Codex 세션은 그대로 통과한다. Codex가 구현
 * 경로를 바꿀 때만 fallback grant를 요구하고, 판단에 필요한 값을 하나라도 못 읽으면
 * 통과시키지 않는다(fail closed).
 *
 * 출력에는 차단된 경로와 부족한 grant 필드 이름만 싣는다. 저장된 증거 값이나 환경
 * 변수 값은 절대 찍지 않는다.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TASK_ID_PATTERN,
  TERMINAL_HANDLE_PATTERN,
  classifyAgent,
  classifyPath,
  normalizeRepoPath,
  parseDispatchOutput,
  validateGrant,
} from './agent-routing-policy.mjs';
import { createOrcaAdapter, grantFilePath, readGrantFile, runGrant } from './agent-routing-grant.mjs';

const USAGE = 'usage: node scripts/verify-agent-routing.mjs [--staged]';

function gitOut(cwd, args) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function lines(text) {
  return String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
}

/**
 * 검사 대상 변경 경로를 모은다.
 *
 * `--staged`는 index만 본다(pre-commit). 기본 모드는 index, 작업 트리, 추적되지 않은
 * 파일을 함께 본다 — 테스트·빌드 시점에는 아직 staged가 아닌 변경이 대부분이다.
 *
 * @returns {string[]} 저장소 상대 POSIX 경로
 */
export function collectChangedPaths({ cwd, staged }) {
  // 삭제(D)와 형식 변경(T)도 반드시 센다. ACMR만 보면 `git rm src/data/api.js`나
  // `git rm .githooks/pre-commit`이 가드에 보이지 않아 그대로 커밋된다.
  const filter = '--diff-filter=ACMRTD';
  const collected = [gitOut(cwd, ['diff', '--cached', '--name-only', filter])];
  if (!staged) {
    collected.push(gitOut(cwd, ['diff', '--name-only', filter]));
    collected.push(gitOut(cwd, ['ls-files', '--others', '--exclude-standard']));
  }
  const unique = new Set();
  for (const chunk of collected) {
    for (const line of lines(chunk)) unique.add(normalizeRepoPath(line) ?? line);
  }
  return [...unique];
}

function report({ error, blockedPaths, reasons, missingFields }) {
  error('[agent-routing] Codex 세션은 구현 경로를 fallback grant 없이 변경할 수 없다.');
  if (blockedPaths.length > 0) {
    error('  차단된 경로:');
    for (const blocked of blockedPaths) error(`    - ${blocked}`);
  }
  if (reasons.length > 0) error(`  위반: ${reasons.join(', ')}`);
  if (missingFields.length > 0) error(`  확인이 필요한 항목: ${missingFields.join(', ')}`);
  error('  구현 작업은 Claude가 이어받는다 (AGENTS.md / docs/agent-workflow.md).');
  error('  Claude 계정 사용량 소진이 증명된 경우에만 코디네이터가 grant를 만든다:');
  error('    node scripts/agent-routing-grant.mjs create --terminal <term> --task <task> \\');
  error('      --evidence-source <enum> --observed-at <iso> --expires-at <iso> \\');
  error('      --allowed-path <path> --remaining-scope <text>');
  error('    node scripts/agent-routing-grant.mjs finalize --terminal <term> --dispatch <ctx>');
}

/**
 * 라우팅 검증 본체.
 *
 * @param {object} [options]
 * @returns {number} 0이면 통과, 1이면 차단
 */
export function runVerify(options = {}) {
  const {
    argv = [],
    cwd = process.cwd(),
    env = process.env,
    now = new Date(),
    orca = createOrcaAdapter(),
    log = console.log,
    error = console.error,
  } = options;

  let staged = false;
  for (const arg of argv) {
    if (arg === '--staged') {
      staged = true;
      continue;
    }
    error(`허용되지 않은 플래그: ${arg}`);
    error(USAGE);
    return 1;
  }

  // Claude와 사람 세션은 이 가드의 대상이 아니다.
  if (classifyAgent(env) !== 'codex') return 0;

  let changedPaths;
  try {
    changedPaths = collectChangedPaths({ cwd, staged });
  } catch (cause) {
    error(`[agent-routing] 변경 경로를 읽을 수 없다: ${String(cause.message ?? cause)}`);
    return 1;
  }
  const implementationPaths = changedPaths.filter((p) => classifyPath(p) === 'implementation');
  if (implementationPaths.length === 0) return 0;

  const terminalHandle = String(env.ORCA_TERMINAL_HANDLE ?? '').trim();
  if (!TERMINAL_HANDLE_PATTERN.test(terminalHandle)) {
    report({
      error,
      blockedPaths: implementationPaths,
      reasons: ['terminal_identity_missing'],
      missingFields: ['ORCA_TERMINAL_HANDLE'],
    });
    return 1;
  }

  let grantFile;
  try {
    grantFile = grantFilePath({ cwd, terminalHandle });
  } catch (cause) {
    report({ error, blockedPaths: implementationPaths, reasons: ['grant_missing'], missingFields: [String(cause.message ?? cause)] });
    return 1;
  }
  const grant = readGrantFile(grantFile);

  // taskId 형식이 확실할 때만 Orca를 호출한다 — 손상된 grant로 하위 프로세스를 부르지 않는다.
  let dispatch = null;
  const taskId = String(grant?.taskId ?? '');
  if (TASK_ID_PATTERN.test(taskId)) {
    try {
      dispatch = parseDispatchOutput(orca.dispatchShow(taskId));
    } catch {
      dispatch = null;
    }
  }

  let tree = null;
  if (staged) {
    try {
      tree = lines(gitOut(cwd, ['write-tree']))[0] ?? null;
    } catch {
      tree = null;
    }
  }

  const verdict = validateGrant({ grant, env, changedPaths, dispatch, now, tree });
  if (!verdict.ok) {
    report({
      error,
      blockedPaths: verdict.blockedPaths,
      reasons: verdict.reasons,
      missingFields: verdict.missingFields,
    });
    return 1;
  }

  // 커밋이 실제로 만들어질 tree에 grant를 묶어둔다. 소진은 post-commit이 한다.
  if (staged && tree) {
    const messages = [];
    const reserved = runGrant({
      argv: ['reserve', '--terminal', terminalHandle, '--tree', tree],
      cwd,
      now,
      orca,
      log: () => {},
      error: (message) => messages.push(String(message)),
    });
    if (reserved !== 0) {
      for (const message of messages) error(message);
      report({ error, blockedPaths: [], reasons: ['grant_reserved_for_another_tree'], missingFields: ['reservation'] });
      return 1;
    }
  }

  log(`[agent-routing] grant 승인: ${terminalHandle} / ${grant.taskId} / ${grant.dispatchId} (허용 경로 ${grant.allowedPaths.length}개)`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runVerify({ argv: process.argv.slice(2) }));
}
