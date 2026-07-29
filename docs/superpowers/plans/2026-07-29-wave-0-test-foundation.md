# Wave 0 Test Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repeatable React unit-test foundation without changing the existing product UI or behavior.

**Architecture:** Vitest will reuse the existing Vite aliases and React transform. Tests run in jsdom, while a single shared setup file installs Testing Library's DOM matchers. The first smoke test exercises the existing `PrimaryButton` component so the foundation proves alias resolution, JSX rendering, user interaction, and cleanup.

**Tech Stack:** React 19, Vite 7, Vitest, jsdom, React Testing Library, jest-dom, user-event

---

## Ownership

- Implementer: Claude
- Reviewer and integrator: Codex
- Allowed files:
  - `package.json`
  - `package-lock.json`
  - `vite.config.js`
  - `src/test/setup.js`
  - `src/components/PrimaryButton.test.jsx`
- Do not modify production components or visual assets.
- Read `CLAUDE.md`, `docs/agent-workflow.md`, and `docs/specs/2026-07-29-mvp-functional-spec.md` before starting.

### Task 1: Install and configure the unit-test runner

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vite.config.js`
- Create: `src/test/setup.js`
- Create: `src/components/PrimaryButton.test.jsx`

- [ ] **Step 1: Install exact test dependencies**

Run:

```bash
npm install --save-dev vitest@^3.2.4 jsdom@^26.1.0 @testing-library/react@^16.3.0 @testing-library/jest-dom@^6.6.3 @testing-library/user-event@^14.6.1
```

Expected: command exits 0 and updates only `package.json` and `package-lock.json`.

- [ ] **Step 2: Add test scripts**

Add the following entries to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Configure Vitest but intentionally omit the setup file**

Extend `vite.config.js`:

```js
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@assets': fileURLToPath(new URL('./design-assets', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

- [ ] **Step 4: Write the smoke test first**

Create `src/components/PrimaryButton.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PrimaryButton from './PrimaryButton';

describe('PrimaryButton', () => {
  it('renders its label and handles a click', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(<PrimaryButton label="시작하기" onClick={onClick} />);

    const button = screen.getByRole('button', { name: '시작하기' });
    expect(button).toBeInTheDocument();

    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 5: Run the test to verify the shared matcher is missing**

Run:

```bash
npm test -- src/components/PrimaryButton.test.jsx
```

Expected: FAIL because `toBeInTheDocument` is not installed.

- [ ] **Step 6: Add the shared setup file**

Create `src/test/setup.js`:

```js
import '@testing-library/jest-dom/vitest';
```

Update the `test` section in `vite.config.js`:

```js
test: {
  environment: 'jsdom',
  globals: true,
  setupFiles: './src/test/setup.js',
},
```

- [ ] **Step 7: Run the focused test**

Run:

```bash
npm test -- src/components/PrimaryButton.test.jsx
```

Expected: 1 test file passes, 1 test passes, 0 failures.

- [ ] **Step 8: Run the full verification**

Run:

```bash
npm test
npm run build
npm run svg:verify
npm run svg:verify-ui
npm run svg:verify-usage
npm run ui:verify-responsive
```

Expected: every command exits 0. Do not run automatic dependency vulnerability fixes as part of this task.

- [ ] **Step 9: Review the diff**

Run:

```bash
git status --short
git add --intent-to-add src/test/setup.js src/components/PrimaryButton.test.jsx
git diff --check
git diff -- package.json package-lock.json vite.config.js src/test/setup.js src/components/PrimaryButton.test.jsx
```

Expected: only the allowed files and lockfile changed; both new files appear in the diff; `git diff --check` exits 0. `--intent-to-add` only makes untracked files visible to review and Step 10 performs the real staging.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json vite.config.js src/test/setup.js src/components/PrimaryButton.test.jsx
git commit -m "test: add React unit test foundation"
```

- [ ] **Step 11: Report completion**

Send exactly one Orca `worker_done` containing:

- commit SHA
- modified files
- focused and full verification results
- dependency audit warning count, without running `npm audit fix`
- remaining risks
