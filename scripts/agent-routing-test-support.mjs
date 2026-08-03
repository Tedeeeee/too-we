/**
 * 라우팅 가드 테스트용 임시 Git 저장소 헬퍼.
 *
 * 모든 테스트는 os.tmpdir() 아래에 폐기용 저장소를 만들고 끝나면 지운다. 개발자
 * 저장소나 사용자 설정을 절대 건드리지 않는다 — `core.hooksPath`를 없는 디렉터리로
 * 고정해 개발자 머신에 이미 설치된 훅이 테스트에 끼어들지 못하게 한다.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const INTEGRATION_BRANCH = 'codex/mvp-integration';

export function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
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

export function writeFile(dir, relativePath, contents) {
  const target = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

export function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}

/** 성공하는 Orca dispatch-show 스텁 — 실제 CLI의 출력 형태를 그대로 흉내낸다. */
export function orcaStub({ dispatchId, taskId, terminalHandle, status = 'dispatched' }) {
  const calls = [];
  return {
    calls,
    dispatchShow(requestedTask) {
      calls.push(requestedTask);
      return {
        status: 0,
        stdout: JSON.stringify({
          result: { dispatch: { id: dispatchId, task_id: taskId, status, assignee_handle: terminalHandle } },
        }),
      };
    },
  };
}
