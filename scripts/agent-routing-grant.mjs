/**
 * Codex fallback grant 수명주기 CLI — 코디네이터 전용.
 *
 *   node scripts/agent-routing-grant.mjs create   --terminal <term> --task <task> --run <run> \
 *                                                 --evidence-source <enum> --observed-at <iso> \
 *                                                 --expires-at <iso> --allowed-path <path> \
 *                                                 --remaining-scope <text>
 *   node scripts/agent-routing-grant.mjs finalize --terminal <term> --dispatch <ctx>
 *   node scripts/agent-routing-grant.mjs status   --terminal <term>
 *   node scripts/agent-routing-grant.mjs reserve  --terminal <term> --tree <tree>
 *   node scripts/agent-routing-grant.mjs consume  --terminal <term> --tree <tree> --commit <sha>
 *
 * grant는 커밋되는 파일이 아니라 공유 Git common 디렉터리 아래에 둔다. 브랜치를 바꿔도
 * 남아 있고 저장소 히스토리에는 들어가지 않는다.
 *
 *   <git-common-dir>/orca-routing-grants/<terminal-handle>.json
 *
 * `create`는 통합 worktree의 통합 브랜치에서만 실행된다. 자식 worktree에서 스스로
 * 허가를 만들어내는 경로를 막기 위한 것이다. 어떤 명령도 자유 서술 payload를 받지
 * 않는다 — 확인 출처는 열거값이고 남은 범위는 길이와 패턴 검사를 통과해야 한다.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMMIT_PATTERN,
  DISPATCH_ID_PATTERN,
  EVIDENCE_SOURCES,
  GRANT_REASON,
  GRANT_VERSION,
  MAX_GRANT_MINUTES,
  MAX_SCOPE_LENGTH,
  PREFLIGHT_DISPATCH,
  RUN_ID_PATTERN,
  TASK_ID_PATTERN,
  TERMINAL_HANDLE_PATTERN,
  TREE_PATTERN,
  containsSecretMaterial,
  isActiveDispatchStatus,
  isIsoInstant,
  normalizeAllowedPaths,
  parseDispatchOutput,
  parseRunOutput,
} from './agent-routing-policy.mjs';

const GRANTS_DIRNAME = 'orca-routing-grants';
const INTEGRATION_BRANCH = 'codex/mvp-integration';
const MINUTE = 60_000;

/** 명령별 허용 플래그. 목록에 없는 플래그는 거부한다 — 자유 payload 유입을 막는다. */
const COMMANDS = {
  create: ['--terminal', '--task', '--run', '--evidence-source', '--observed-at', '--expires-at', '--allowed-path', '--remaining-scope'],
  finalize: ['--terminal', '--dispatch'],
  status: ['--terminal'],
  reserve: ['--terminal', '--tree'],
  consume: ['--terminal', '--tree', '--commit'],
};

const REPEATABLE = new Set(['--allowed-path']);

/** usage 출력에 쓰는 플래그별 placeholder — 그대로 복사해 채울 수 있게 이름을 보여준다. */
const FLAG_PLACEHOLDERS = {
  '--terminal': '<term>',
  '--task': '<task>',
  '--run': '<run>',
  '--dispatch': '<ctx>',
  '--evidence-source': '<enum>',
  '--observed-at': '<iso>',
  '--expires-at': '<iso>',
  '--allowed-path': '<path>',
  '--remaining-scope': '<text>',
  '--tree': '<tree>',
  '--commit': '<sha>',
};

const USAGE = [
  'usage: node scripts/agent-routing-grant.mjs <command> [flags]',
  ...Object.entries(COMMANDS).map(([name, flags]) => {
    const rendered = flags.map((flag) => `${flag} ${FLAG_PLACEHOLDERS[flag] ?? '<value>'}`).join(' ');
    return `  ${name} ${rendered}`;
  }),
].join('\n');

function gitOut(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** 공유 Git common 디렉터리. 링크된 worktree에서도 같은 값이 나온다. */
export function resolveCommonDir(cwd) {
  return path.resolve(gitOut(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
}

/** `git worktree list`의 첫 항목이 언제나 주 worktree다. */
export function resolvePrimaryWorktree(cwd) {
  const first = gitOut(cwd, ['worktree', 'list', '--porcelain'])
    .split(/\r?\n/)
    .find((line) => line.startsWith('worktree '));
  if (!first) throw new Error('주 worktree를 찾을 수 없다');
  return fs.realpathSync(path.resolve(first.slice('worktree '.length).trim()));
}

/**
 * grant 파일 경로. terminal handle이 경로를 벗어나지 못하도록 형식을 먼저 검사한다.
 *
 * @param {{ cwd?: string, terminalHandle: string, commonDir?: string }} options
 */
export function grantFilePath({ cwd, terminalHandle, commonDir }) {
  if (!TERMINAL_HANDLE_PATTERN.test(String(terminalHandle ?? ''))) {
    throw new Error('terminal handle 형식이 올바르지 않다');
  }
  const dir = path.join(commonDir ?? resolveCommonDir(cwd ?? process.cwd()), GRANTS_DIRNAME);
  const file = path.join(dir, `${terminalHandle}.json`);
  if (path.dirname(file) !== dir) throw new Error('grant 경로가 grant 디렉터리를 벗어난다');
  return file;
}

export function readGrantFile(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 임시 파일에 쓰고 rename — 훅이 반쯤 쓰인 grant를 읽는 일이 없게 한다. */
function writeGrantFile(file, grant) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(grant, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}

function parseArgv(argv) {
  const command = argv[0];
  const allowed = COMMANDS[command];
  if (!allowed) return { errors: [`알 수 없는 명령: ${command ?? '(없음)'}`, USAGE] };

  const values = new Map();
  const errors = [];
  for (let i = 1; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!allowed.includes(flag)) {
      errors.push(`허용되지 않은 플래그: ${flag}`);
      continue;
    }
    const value = argv[i + 1];
    i += 1;
    if (value === undefined || value.startsWith('--')) {
      errors.push(`${flag} 값이 없다`);
      continue;
    }
    if (REPEATABLE.has(flag)) {
      values.set(flag, [...(values.get(flag) ?? []), value]);
    } else if (values.has(flag)) {
      errors.push(`${flag}는 한 번만 지정한다`);
    } else {
      values.set(flag, value);
    }
  }
  for (const flag of allowed) {
    if (!values.has(flag)) errors.push(`${flag} 플래그가 필요하다`);
  }
  return { command, values, errors };
}

/** 실제 Orca CLI 어댑터. 테스트는 같은 모양의 스텁을 주입한다. */
export function createOrcaAdapter() {
  /** 식별자는 호출 전에 패턴 검사를 통과하므로 셸 메타문자가 들어올 수 없다. */
  const run = (args) => {
    const result = spawnSync('orca', args, {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    if (result.error) throw result.error;
    return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };
  return {
    dispatchShow(taskId) {
      return run(['orchestration', 'dispatch-show', '--task', taskId, '--json']);
    },
    runShow(runId) {
      return run(['orchestration', 'run-show', '--id', runId, '--json']);
    },
  };
}

/**
 * 이 세션이 해당 Run의 코디네이터인지 확인한다.
 *
 * 주 통합 worktree에서 실행한다는 조건만으로는 부족하다 — 구현 작업자가 통합 worktree로
 * 이동해 자기 grant를 발급할 수 있기 때문이다. Run의 `coordinator_handle`과 현재 세션의
 * `ORCA_TERMINAL_HANDLE`이 정확히 같을 때만 발급을 허용한다.
 *
 * @returns {string|null} 확인된 코디네이터 handle, 실패 시 null
 */
function verifyCoordinatorAuthority({ orca, runId, env, fail }) {
  const sessionTerminal = String(env?.ORCA_TERMINAL_HANDLE ?? '').trim();
  if (!TERMINAL_HANDLE_PATTERN.test(sessionTerminal)) {
    fail('ORCA_TERMINAL_HANDLE이 없어 coordinator 권한을 확인할 수 없다');
    return null;
  }
  let raw;
  try {
    raw = orca.runShow(runId);
  } catch {
    fail('Orca run-show를 실행할 수 없어 coordinator 권한을 확인할 수 없다');
    return null;
  }
  const run = parseRunOutput(raw);
  if (!run) {
    fail('Orca run-show 출력에서 coordinator_handle을 읽을 수 없다');
    return null;
  }
  if (run.runId !== '' && run.runId !== runId) {
    fail('run-show가 요청한 Run과 다른 Run을 반환했다');
    return null;
  }
  if (run.coordinatorHandle !== sessionTerminal) {
    fail('이 터미널은 해당 Run의 coordinator가 아니다 — grant는 coordinator만 발급한다');
    return null;
  }
  return run.coordinatorHandle;
}

/** create/finalize는 주 통합 worktree의 통합 브랜치에서만 실행된다. */
function assertIntegrationWorktree({ cwd, fail }) {
  let primary;
  try {
    primary = resolvePrimaryWorktree(cwd);
  } catch (cause) {
    fail(String(cause.message ?? cause));
    return false;
  }
  if (fs.realpathSync(path.resolve(cwd)) !== primary) {
    fail(`grant는 primary worktree(${primary})에서만 다룰 수 있다`);
    return false;
  }
  const branch = gitOut(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== INTEGRATION_BRANCH) {
    fail(`grant는 ${INTEGRATION_BRANCH} 브랜치에서만 다룰 수 있다 (현재 ${branch})`);
    return false;
  }
  return true;
}

/** 살아 있는 dispatch를 읽어 grant와 대조한다. 못 읽으면 닫는다. */
function verifyDispatch({ orca, taskId, dispatchId, runId, terminalHandle, fail }) {
  let raw;
  try {
    raw = orca.dispatchShow(taskId);
  } catch {
    fail('Orca dispatch-show를 실행할 수 없다 — grant를 finalize하지 않는다');
    return null;
  }
  const dispatch = parseDispatchOutput(raw);
  if (!dispatch) {
    fail('Orca dispatch-show 출력을 읽을 수 없다 — grant를 finalize하지 않는다');
    return null;
  }
  if (dispatch.dispatchId !== dispatchId) {
    fail('살아 있는 Dispatch ID가 --dispatch 값과 다르다');
    return null;
  }
  if (dispatch.taskId !== taskId) {
    fail('살아 있는 Dispatch의 Task가 grant의 Task와 다르다');
    return null;
  }
  if (dispatch.runId === '' || dispatch.runId !== runId) {
    fail('살아 있는 Dispatch의 Run이 grant의 Run과 다르다');
    return null;
  }
  if (dispatch.terminalHandle !== terminalHandle) {
    fail('Dispatch 담당 terminal이 grant terminal과 다르다');
    return null;
  }
  if (!isActiveDispatchStatus(dispatch.status)) {
    fail('Dispatch가 활성 상태가 아니다');
    return null;
  }
  return dispatch;
}

/**
 * grant CLI 본체.
 *
 * @param {object} [options]
 * @returns {number} 프로세스 종료 코드
 */
export function runGrant(options = {}) {
  const {
    argv = [],
    cwd = process.cwd(),
    env = process.env,
    now = new Date(),
    orca = createOrcaAdapter(),
    log = console.log,
    error = console.error,
  } = options;

  const problems = [];
  const fail = (message) => problems.push(message);
  const finish = () => {
    for (const message of problems) error(message);
    return problems.length === 0 ? 0 : 1;
  };

  const { command, values, errors } = parseArgv(argv);
  if (errors?.length) {
    for (const message of errors) error(message);
    return 1;
  }

  const at = now instanceof Date ? now.getTime() : Number(now);
  const nowIso = new Date(at).toISOString();
  const terminalHandle = values.get('--terminal');
  if (!TERMINAL_HANDLE_PATTERN.test(terminalHandle)) {
    error('--terminal 값이 Orca terminal handle 형식이 아니다');
    return 1;
  }

  let file;
  try {
    file = grantFilePath({ cwd, terminalHandle });
  } catch (cause) {
    error(String(cause.message ?? cause));
    return 1;
  }
  const existing = readGrantFile(file);

  if (command === 'create') {
    assertIntegrationWorktree({ cwd, fail });

    const taskId = values.get('--task');
    if (!TASK_ID_PATTERN.test(taskId)) fail('--task 값이 Orca task id 형식이 아니다');

    const runId = values.get('--run');
    if (!RUN_ID_PATTERN.test(runId)) fail('--run 값이 Orca run id 형식이 아니다');

    const evidenceSource = values.get('--evidence-source');
    if (!EVIDENCE_SOURCES.includes(evidenceSource)) {
      fail(`--evidence-source는 다음 중 하나여야 한다: ${EVIDENCE_SOURCES.join(', ')}`);
    }

    const observedAt = values.get('--observed-at');
    if (!isIsoInstant(observedAt)) {
      fail('--observed-at은 ISO-8601 시각이어야 한다');
    } else if (Date.parse(observedAt) > at) {
      fail('--observed-at이 미래다');
    } else if (Date.parse(observedAt) < at - MAX_GRANT_MINUTES * MINUTE) {
      fail(`--observed-at이 ${MAX_GRANT_MINUTES}분보다 오래됐다 — 사용량을 다시 확인한다`);
    }

    const expiresAt = values.get('--expires-at');
    if (!isIsoInstant(expiresAt)) {
      fail('--expires-at은 ISO-8601 시각이어야 한다');
    } else if (Date.parse(expiresAt) <= at) {
      fail('--expires-at이 이미 지났다');
    } else if (Date.parse(expiresAt) > at + MAX_GRANT_MINUTES * MINUTE) {
      fail(`--expires-at은 지금부터 ${MAX_GRANT_MINUTES}분 이내여야 한다`);
    }

    const allowed = normalizeAllowedPaths(values.get('--allowed-path'));
    if (allowed.rejected.length > 0 || allowed.paths.length === 0) {
      fail('--allowed-path는 저장소 루트, glob, 상위 경로, 절대 경로를 쓸 수 없다');
    }

    const remainingScope = values.get('--remaining-scope');
    if (remainingScope.trim() === '' || remainingScope.length > MAX_SCOPE_LENGTH) {
      fail(`--remaining-scope는 1..${MAX_SCOPE_LENGTH}자여야 한다`);
    } else if (containsSecretMaterial(remainingScope)) {
      fail('--remaining-scope에 비밀정보처럼 보이는 값이 있다 — 남은 범위만 적는다');
    }

    if (existing && existing.status !== 'consumed' && isIsoInstant(existing.expiresAt) && Date.parse(existing.expiresAt) > at) {
      fail('이미 살아 있는 grant가 있다 — 소진되거나 만료된 뒤에 다시 만든다');
    }

    if (problems.length > 0) return finish();

    const coordinatorHandle = verifyCoordinatorAuthority({ orca, runId, env, fail });
    if (!coordinatorHandle) return finish();
    if (coordinatorHandle === terminalHandle) {
      fail('coordinator 터미널에 grant를 발급할 수 없다 — 구현 작업자 터미널을 분리한다');
      return finish();
    }

    writeGrantFile(file, {
      version: GRANT_VERSION,
      reason: GRANT_REASON,
      status: 'provisional',
      terminalHandle,
      taskId,
      dispatchId: PREFLIGHT_DISPATCH,
      runId,
      issuedByCoordinatorHandle: coordinatorHandle,
      evidenceSource,
      observedAt,
      expiresAt,
      allowedPaths: allowed.paths,
      remainingScope: remainingScope.trim(),
      createdAt: nowIso,
    });
    log(`grant 생성됨 (provisional): ${terminalHandle} / ${taskId}`);
    log('dispatch 후 finalize를 실행해야 가드가 열린다.');
    return 0;
  }

  if (command === 'status') {
    if (!existing) {
      log(`no grant for ${terminalHandle}`);
      return 0;
    }
    const allowedCount = Array.isArray(existing.allowedPaths) ? existing.allowedPaths.length : 0;
    log([
      `status=${existing.status ?? 'unknown'}`,
      `terminal=${existing.terminalHandle ?? 'unknown'}`,
      `task=${existing.taskId ?? 'unknown'}`,
      `dispatch=${existing.dispatchId ?? 'unknown'}`,
      `expiresAt=${existing.expiresAt ?? 'unknown'}`,
      `allowedPaths=${allowedCount}`,
      `reserved=${existing.reservation?.tree ? 'yes' : 'no'}`,
    ].join(' '));
    return 0;
  }

  if (!existing) {
    error(`grant가 없다: ${terminalHandle}`);
    return 1;
  }

  if (command === 'finalize') {
    assertIntegrationWorktree({ cwd, fail });
    const dispatchId = values.get('--dispatch');
    if (!DISPATCH_ID_PATTERN.test(dispatchId)) fail('--dispatch 값이 Orca dispatch id 형식이 아니다');
    if (existing.status !== 'provisional') fail(`grant가 이미 ${existing.status} 상태다 — finalize는 한 번만 한다`);
    if (!TASK_ID_PATTERN.test(String(existing.taskId ?? ''))) fail('grant의 taskId가 손상됐다');
    if (!RUN_ID_PATTERN.test(String(existing.runId ?? ''))) fail('grant의 runId가 손상됐다');
    if (!isIsoInstant(existing.expiresAt) || Date.parse(existing.expiresAt) <= at) fail('grant가 만료됐다');
    if (problems.length > 0) return finish();

    const coordinatorHandle = verifyCoordinatorAuthority({ orca, runId: existing.runId, env, fail });
    if (!coordinatorHandle) return finish();
    if (coordinatorHandle !== String(existing.issuedByCoordinatorHandle ?? '')) {
      fail('grant를 발급한 coordinator와 finalize하는 coordinator가 다르다');
      return finish();
    }

    if (!verifyDispatch({ orca, taskId: existing.taskId, dispatchId, runId: existing.runId, terminalHandle, fail })) {
      return finish();
    }

    writeGrantFile(file, { ...existing, status: 'active', dispatchId, finalizedAt: nowIso });
    log(`grant finalize됨: ${terminalHandle} / ${dispatchId}`);
    return 0;
  }

  if (command === 'reserve') {
    const tree = values.get('--tree');
    if (!TREE_PATTERN.test(tree)) fail('--tree 값이 Git tree 식별자 형식이 아니다');
    if (existing.status !== 'active') fail(`grant가 활성 상태가 아니다 (${existing.status})`);
    if (!isIsoInstant(existing.expiresAt) || Date.parse(existing.expiresAt) <= at) fail('grant가 만료됐다');
    const reserved = existing.reservation?.tree;
    if (reserved && reserved !== tree) fail('grant가 다른 staged tree에 예약돼 있다');
    if (problems.length > 0) return finish();

    if (reserved !== tree) writeGrantFile(file, { ...existing, reservation: { tree, reservedAt: nowIso } });
    return 0;
  }

  if (command === 'consume') {
    const tree = values.get('--tree');
    const commit = values.get('--commit');
    if (!TREE_PATTERN.test(tree)) fail('--tree 값이 Git tree 식별자 형식이 아니다');
    if (!COMMIT_PATTERN.test(commit)) fail('--commit 값이 커밋 SHA 형식이 아니다');
    if (existing.status !== 'active') fail(`grant가 활성 상태가 아니다 (${existing.status})`);
    if (existing.reservation?.tree !== tree) fail('이 staged tree로 예약된 grant가 아니다');
    if (problems.length > 0) return finish();

    writeGrantFile(file, { ...existing, status: 'consumed', consumedAt: nowIso, consumedCommit: commit });
    log(`grant 소진됨: ${terminalHandle} / ${commit}`);
    return 0;
  }

  error(USAGE);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runGrant({ argv: process.argv.slice(2) }));
}
