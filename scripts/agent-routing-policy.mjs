/**
 * 구현 작업자 라우팅 정책 — 순수 함수만 둔다.
 *
 * 이 모듈은 파일시스템, Git, Orca, process.env를 직접 읽지 않는다. 호출자가 수집한
 * 값을 받아 판정만 하므로 테스트가 개발자 머신 환경에 흔들리지 않는다.
 *
 * 정책 근거는 `AGENTS.md`와 `docs/agent-workflow.md`의 "구현 작업자 라우팅"이다.
 * 구현 작업은 Claude가 최초로 받고, Codex 구현은 Claude 계정 사용량 소진이 증명된
 * 경우에만 짧은 범위 grant로 허용한다.
 */

/** grant가 인정하는 유일한 사유. 이 문자열이 아니면 무조건 거부한다. */
export const GRANT_REASON = 'claude_account_capacity_exhausted';

/** 사용량 소진 확인 출처 — 자유 서술을 막기 위해 열거값으로 고정한다. */
export const EVIDENCE_SOURCES = Object.freeze([
  'read-only-usage-check',
  'claude-response-classification',
]);

/** grant 파일에 허용되는 최상위 키. 알 수 없는 키는 스키마 위반으로 막는다. */
const GRANT_FIELDS = Object.freeze([
  'version',
  'reason',
  'status',
  'terminalHandle',
  'taskId',
  'dispatchId',
  'evidenceSource',
  'observedAt',
  'expiresAt',
  'allowedPaths',
  'remainingScope',
  'createdAt',
  'finalizedAt',
  'reservation',
  'consumedAt',
  'consumedCommit',
]);

/** finalize 전 dispatchId 자리에 들어가는 표식 — 검증에서는 통과시키지 않는다. */
export const PREFLIGHT_DISPATCH = 'not-created-preflight';

/** Orca terminal handle 형식. grant 파일명에 쓰이므로 경로 문자를 허용하지 않는다. */
export const TERMINAL_HANDLE_PATTERN = /^term_[A-Za-z0-9._-]{1,80}$/;

export const GRANT_VERSION = 1;
export const MAX_SCOPE_LENGTH = 300;
export const MAX_GRANT_MINUTES = 60;

/** dispatch가 살아 있다고 인정하는 상태. 목록에 없는 값은 fail closed. */
const ACTIVE_DISPATCH_STATUSES = new Set([
  'active',
  'running',
  'dispatched',
  'assigned',
  'in_progress',
  'in-progress',
  'working',
]);

const CODEX_MARKERS = ['CODEX_THREAD_ID', 'CODEX_HOME', 'CODEX_SESSION_ID', 'CODEX_CLI_VERSION'];
const CLAUDE_MARKERS = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID'];

/**
 * 조정자(Codex)가 grant 없이 손댈 수 있는 저장소 루트 파일.
 *
 * 가드 자신(`.githooks/**`, `scripts/*agent-routing*`, `.claude/settings.json`)과
 * `package.json`은 의도적으로 빠져 있다. 가드를 조정자 소유로 두면 Codex가 가드를
 * 고쳐서 우회할 수 있고, 설치는 Claude가 수행하므로 초기 예외도 필요 없다.
 */
const COORDINATOR_ROOT_FILES = new Set(['AGENTS.md', 'CLAUDE.md', 'README.md']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hasMarker(env, names) {
  return names.some((name) => text(env[name]) !== '');
}

/**
 * 세션 주체를 판정한다.
 *
 * Codex와 Claude 표식이 함께 있으면 Codex로 본다 — 정체가 모순될 때 더 엄격한 쪽으로
 * 닫아야 하기 때문이다(설계서 "Missing or contradictory identity fails closed").
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {'codex'|'claude'|'human'}
 */
export function classifyAgent(env) {
  const source = env && typeof env === 'object' ? env : {};
  const declared = text(source.ORCA_AGENT).toLowerCase();
  if (declared === 'codex' || hasMarker(source, CODEX_MARKERS)) return 'codex';
  if (declared === 'claude' || hasMarker(source, CLAUDE_MARKERS)) return 'claude';
  return 'human';
}

/**
 * 저장소 상대 경로를 POSIX 형태로 정규화한다. 저장소를 벗어나는 값은 null.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeRepoPath(value) {
  if (typeof value !== 'string') return null;
  let candidate = value.trim().replace(/\\/g, '/');
  if (candidate === '') return null;
  while (candidate.startsWith('./')) candidate = candidate.slice(2);
  candidate = candidate.replace(/\/+$/, '');
  if (candidate === '' || candidate === '.') return null;
  if (candidate.startsWith('/') || /^[A-Za-z]:/.test(candidate)) return null;
  if (candidate.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) return null;
  return candidate;
}

/**
 * 변경 경로가 조정자 업무인지 구현 업무인지 분류한다.
 *
 * 문서는 `docs/**` 의 Markdown만 조정자 몫이다. `docs/` 아래 이미지나 확장자 없는
 * 파일은 판단 근거가 없으므로 구현으로 닫는다.
 *
 * @param {unknown} relativePath
 * @returns {'coordinator'|'implementation'}
 */
export function classifyPath(relativePath) {
  const p = normalizeRepoPath(relativePath);
  if (!p) return 'implementation';
  if (COORDINATOR_ROOT_FILES.has(p)) return 'coordinator';
  if (p.startsWith('docs/') && p.toLowerCase().endsWith('.md')) return 'coordinator';
  return 'implementation';
}

/**
 * grant의 allowedPaths를 정규화한다. 저장소 루트, glob, 상위 탐색, 절대 경로는 거부.
 *
 * @param {unknown} values
 * @returns {{ paths: string[], rejected: unknown[] }}
 */
export function normalizeAllowedPaths(values) {
  const list = values === undefined || values === null
    ? []
    : Array.isArray(values) ? values : [values];
  const paths = [];
  const rejected = [];
  for (const value of list) {
    const normalized = normalizeRepoPath(value);
    if (!normalized || /[*?[\]]/.test(normalized)) {
      rejected.push(value);
      continue;
    }
    if (!paths.includes(normalized)) paths.push(normalized);
  }
  return { paths, rejected };
}

/** allowedPath 하나가 대상 경로를 덮는지 — 이름 앞부분만 겹치는 형제는 덮지 않는다. */
function covers(allowed, target) {
  return target === allowed || target.startsWith(`${allowed}/`);
}

function firstString(source, keys) {
  for (const key of keys) {
    const value = text(source?.[key]);
    if (value !== '') return value;
  }
  return '';
}

/**
 * `orca orchestration dispatch-show --json` 출력에서 필요한 네 값을 뽑는다.
 *
 * 실제 출력 형태를 저장소가 고정할 수 없으므로 흔한 별칭까지 받아들이되, dispatchId와
 * 담당 terminal을 못 읽으면 null을 돌려 호출자가 닫도록 한다.
 *
 * @param {unknown} raw
 * @returns {{ dispatchId: string, taskId: string, status: string, terminalHandle: string }|null}
 */
export function normalizeDispatch(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // 실제 출력은 `{ result: { dispatch: {...} } }` 처럼 중첩돼 있어 한 겹씩 반복해서 벗긴다.
  let node = raw;
  for (let depth = 0; depth < 6; depth += 1) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) break;
    const key = ['result', 'data', 'dispatch', 'dispatches', 'items']
      .find((candidate) => node[candidate] && typeof node[candidate] === 'object');
    if (!key) break;
    node = node[key];
  }
  if (Array.isArray(node)) {
    const entries = node.filter((entry) => entry && typeof entry === 'object');
    node = entries.find((entry) => ACTIVE_DISPATCH_STATUSES.has(firstString(entry, ['status', 'state']).toLowerCase()))
      ?? entries[0];
  }
  if (!node || typeof node !== 'object') return null;

  const assignee = node.assignee && typeof node.assignee === 'object' ? node.assignee : {};
  const dispatchId = firstString(node, ['dispatchId', 'dispatch_id', 'contextId', 'context_id', 'id']);
  const terminalHandle = firstString(node, [
    'assigneeTerminal',
    'assignee_terminal',
    'assigneeHandle',
    'assignee_handle',
    'terminalHandle',
    'terminal_handle',
    'terminal',
  ]) || firstString(assignee, ['terminalHandle', 'terminal_handle', 'terminal', 'handle']);
  if (dispatchId === '' || terminalHandle === '') return null;

  return {
    dispatchId,
    taskId: firstString(node, ['taskId', 'task_id', 'task']),
    status: firstString(node, ['status', 'state']),
    terminalHandle,
  };
}

function isIsoInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})$/.test(value.trim())) return false;
  return Number.isFinite(Date.parse(value));
}

/**
 * fallback grant가 지금 이 변경을 허가하는지 판정한다.
 *
 * 위반은 하나만 찾고 멈추지 않고 전부 모아 돌려준다 — 코디네이터가 한 번에 고칠 수
 * 있어야 한다. 반환값에는 저장된 증거 값(사유 문구, 확인 출처, 남은 범위)을 담지
 * 않는다. 필드 이름과 안정적인 코드만 노출한다.
 *
 * @param {object} options
 * @param {unknown} options.grant       grant 파일 내용
 * @param {Record<string, string|undefined>} options.env  현재 세션 환경
 * @param {string[]} options.changedPaths 저장소 상대 변경 경로
 * @param {unknown} options.dispatch    normalizeDispatch 결과 또는 원본 JSON
 * @param {Date|number} [options.now]
 * @param {string|null} [options.tree]  staged tree — 예약된 grant 재사용을 막는다
 * @returns {{ ok: boolean, reasons: string[], missingFields: string[], blockedPaths: string[] }}
 */
export function validateGrant({ grant, env, changedPaths, dispatch, now, tree } = {}) {
  const reasons = [];
  const missingFields = [];
  const at = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.now();
  const add = (reason, field) => {
    if (!reasons.includes(reason)) reasons.push(reason);
    if (field && !missingFields.includes(field)) missingFields.push(field);
  };

  const sessionTerminal = text((env && typeof env === 'object' ? env : {}).ORCA_TERMINAL_HANDLE);
  if (sessionTerminal === '' || !TERMINAL_HANDLE_PATTERN.test(sessionTerminal)) {
    add('terminal_identity_missing', 'ORCA_TERMINAL_HANDLE');
  }

  const implementationPaths = (Array.isArray(changedPaths) ? changedPaths : [])
    .map((value) => normalizeRepoPath(value) ?? String(value ?? ''))
    .filter((value) => classifyPath(value) === 'implementation');

  const isPlainObject = grant && typeof grant === 'object' && !Array.isArray(grant);
  if (!isPlainObject) {
    add('grant_missing', 'grant');
    return { ok: false, reasons, missingFields, blockedPaths: implementationPaths };
  }

  for (const key of Object.keys(grant)) {
    if (!GRANT_FIELDS.includes(key)) add('grant_schema_unknown_field', key);
  }

  if (grant.version !== GRANT_VERSION) add('grant_version_unsupported', 'version');
  if (grant.reason !== GRANT_REASON) add('grant_reason_invalid', 'reason');

  const status = text(grant.status);
  if (status === 'consumed' || text(grant.consumedAt) !== '') {
    add('grant_already_consumed', 'status');
  } else if (status !== 'active' || text(grant.dispatchId) === '' || grant.dispatchId === PREFLIGHT_DISPATCH) {
    add('grant_not_finalized', 'dispatchId');
  }

  const grantTerminal = text(grant.terminalHandle);
  if (grantTerminal === '' || !TERMINAL_HANDLE_PATTERN.test(grantTerminal)) {
    add('terminal_mismatch', 'terminalHandle');
  } else if (sessionTerminal !== '' && grantTerminal !== sessionTerminal) {
    add('terminal_mismatch', 'terminalHandle');
  }

  if (text(grant.taskId) === '') add('task_id_missing', 'taskId');
  if (!EVIDENCE_SOURCES.includes(grant.evidenceSource)) add('evidence_source_invalid', 'evidenceSource');

  if (!isIsoInstant(grant.observedAt) || Date.parse(grant.observedAt) > at) {
    add('observed_at_invalid', 'observedAt');
  }
  if (!isIsoInstant(grant.expiresAt)) {
    add('expires_at_invalid', 'expiresAt');
  } else if (Date.parse(grant.expiresAt) <= at) {
    add('grant_expired', 'expiresAt');
  }

  const scope = text(grant.remainingScope);
  if (scope === '' || scope.length > MAX_SCOPE_LENGTH) add('remaining_scope_invalid', 'remainingScope');

  const allowed = normalizeAllowedPaths(grant.allowedPaths);
  if (allowed.paths.length === 0 || allowed.rejected.length > 0) add('allowed_paths_invalid', 'allowedPaths');

  const normalizedDispatch = normalizeDispatch(dispatch);
  if (!normalizedDispatch) {
    add('dispatch_unverified', 'dispatch');
  } else {
    if (text(grant.dispatchId) !== '' && normalizedDispatch.dispatchId !== text(grant.dispatchId)) {
      add('dispatch_id_mismatch', 'dispatchId');
    }
    if (text(grant.taskId) !== '' && normalizedDispatch.taskId !== text(grant.taskId)) {
      add('dispatch_task_mismatch', 'taskId');
    }
    if (grantTerminal !== '' && normalizedDispatch.terminalHandle !== grantTerminal) {
      add('dispatch_assignee_mismatch', 'terminalHandle');
    }
    if (!ACTIVE_DISPATCH_STATUSES.has(normalizedDispatch.status.toLowerCase())) {
      add('dispatch_inactive', 'dispatch');
    }
  }

  const reservedTree = text(grant.reservation?.tree);
  const stagedTree = text(tree);
  if (reservedTree !== '' && stagedTree !== '' && reservedTree !== stagedTree) {
    add('grant_reserved_for_another_tree', 'reservation');
  }

  const blockedPaths = allowed.paths.length === 0
    ? implementationPaths
    : implementationPaths.filter((p) => !allowed.paths.some((prefix) => covers(prefix, p)));
  if (blockedPaths.length > 0) add('paths_not_allowed', 'allowedPaths');

  return { ok: reasons.length === 0, reasons, missingFields, blockedPaths };
}
