# Onboarding Code Gap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the vertical gap between each invite-code digit and its hand-drawn underline.

**Architecture:** Keep the six digit cells and digit positions unchanged. Move only the `HandDrawnLine` inside every repeated cell from local top 101 to 73, preserving all horizontal alignment and input behavior.

**Tech Stack:** React 19, existing `HandDrawnLine`, Node verification script, Vite, Playwright

---

### Task 1: Add and satisfy the underline-position contract

**Files:**
- Modify: `scripts/verify-svg-usage.mjs`
- Modify: `src/screens/OnboardingCode.jsx`

- [ ] **Step 1: Write the failing check**

Update the existing `OnboardingCode: each digit owns one underline cell` contract to require the repeated `HandDrawnLine` style to include `top: 73`.

- [ ] **Step 2: Verify RED**

Run: `npm run svg:verify-usage`

Expected: only the code-cell positioning check fails because the component still uses `top: 101`.

- [ ] **Step 3: Move the line**

In `src/screens/OnboardingCode.jsx`, change the repeated `HandDrawnLine` style from:

```jsx
top: 101,
```

to:

```jsx
top: 73,
```

- [ ] **Step 4: Verify GREEN**

Run: `npm run svg:verify-usage`

Expected: every usage check passes.

### Task 2: Verify rendering

**Files:**
- No production changes expected.

- [ ] **Step 1: Run complete verification**

Run:

```text
npm run svg:verify-usage
npm run svg:verify
npm run build
```

Expected: zero failures and a successful Vite build.

- [ ] **Step 2: Inspect one-digit and six-digit states**

At 402×874, fill `6` and `133221`. Confirm:

- all underline bounding boxes start at screen y=465;
- each digit and its underline retain identical horizontal centers;
- digits and lines do not overlap;
- no images are broken.

## Repository Constraint

Do not commit: the repository has no baseline commit and commits require an explicit user request.
