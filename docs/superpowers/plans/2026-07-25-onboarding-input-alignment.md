# Onboarding Input Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Center each invite-code digit over its own hand-drawn underline and reduce the name-to-underline gap.

**Architecture:** Replace the code screen’s independent digit string and underline row with six equal cell wrappers, each rendering `code[i]` and one `HandDrawnLine`. Keep the name input in place while moving its line and counter group upward by exactly 28px.

**Tech Stack:** React 19, Vite, inline styles, existing `HandDrawnLine`, Node verification script, Playwright

---

## File Structure

- Modify `scripts/verify-svg-usage.mjs`: add RED/GREEN layout contracts.
- Modify `src/screens/OnboardingCode.jsx`: render six digit-and-line cells.
- Modify `src/screens/OnboardingName.jsx`: move line and counter upward.

### Task 1: Add failing layout contracts

**Files:**
- Modify: `scripts/verify-svg-usage.mjs`

- [ ] **Step 1: Add a code-cell contract**

Require `OnboardingCode.jsx` to:

- render `code[i] ?? ''` inside the six-item loop;
- include a `data-code-cell` wrapper for browser coordinate checks;
- remove `letterSpacing: 22`.

- [ ] **Step 2: Add a name-spacing contract**

Extract the name screen’s `HandDrawnLine` element and verify its inline position is `top: 465`. Verify the counter containing `{name.length}/12` uses `top: 486`.

- [ ] **Step 3: Verify RED**

Run: `npm run svg:verify-usage`

Expected: two new checks fail because digits are still a standalone string and the name line group is still at top 493/514.

### Task 2: Render six self-contained code cells

**Files:**
- Modify: `src/screens/OnboardingCode.jsx`

- [ ] **Step 1: Remove the standalone digit string**

Delete the absolute block that renders `{code}` with `letterSpacing: 22`.

- [ ] **Step 2: Replace the line-only row**

Move the six-item container to `top: 392` and give it `height: 113`. For each index, render:

```jsx
<div
  key={i}
  data-code-cell={i}
  style={{ position: 'relative', flex: 1, minWidth: 0, height: 113 }}
>
  <div
    data-code-digit={i}
    style={{
      position: 'absolute',
      left: 0,
      top: 0,
      width: '100%',
      height: 80,
      textAlign: 'center',
      fontFamily: fonts.hand,
      fontSize: 80,
      lineHeight: 1,
      color: palette.text,
    }}
  >
    {code[i] ?? ''}
  </div>
  <HandDrawnLine
    variant="short"
    color={isCaret || filled ? palette.text : palette.beige}
    width="100%"
    height={10}
    style={{
      position: 'absolute',
      left: 0,
      top: 101,
      transform: isCaret ? 'scaleY(1.2)' : undefined,
    }}
  />
</div>
```

Keep the existing hidden input, digit sanitization, length limit, state colors, and connect behavior.

- [ ] **Step 3: Verify the code-cell contract**

Run: `npm run svg:verify-usage`

Expected: code-cell check passes; name-spacing check remains RED.

### Task 3: Reduce the name input gap

**Files:**
- Modify: `src/screens/OnboardingName.jsx`

- [ ] **Step 1: Move the line group**

Change `HandDrawnLine` from `top: 493` to `top: 465`.

- [ ] **Step 2: Move the counter**

Change the `{name.length}/12` counter from `top: 514` to `top: 486`.

- [ ] **Step 3: Verify GREEN**

Run: `npm run svg:verify-usage`

Expected: all usage checks pass with zero failures.

### Task 4: Verify rendered alignment

**Files:**
- No production changes expected.

- [ ] **Step 1: Run static verification**

Run:

```text
npm run svg:verify-usage
npm run svg:verify
npm run build
```

Expected: zero failures and a successful production build.

- [ ] **Step 2: Inspect one-digit and six-digit code states**

At 402×874, fill `6` and `482195`. For every filled `data-code-cell`, confirm the digit wrapper and SVG mask have the same horizontal center.

- [ ] **Step 3: Inspect name spacing**

Fill a short and a longer name. Confirm the line has `top=465`, the counter has `top=486`, neither overlaps the text, and both remain inside the 358px input width.

## Repository Constraint

Do not create commits or a worktree: the repository has no baseline commit and `CLAUDE.md` allows commits only when the user explicitly requests them.
