# Map SVG Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse the existing time icon and hand-drawn line SVGs across the map chips and bottom place sheet.

**Architecture:** Import `uiSvg.time` directly into `MapSelect` for the two memo chips. Replace the three straight row dividers with the existing mask-based `HandDrawnLine`, preserving each old divider’s center coordinate and every row’s click overlay.

**Tech Stack:** React 19, existing SVG registry, existing `HandDrawnLine`, Node verification script, Vite, Playwright

---

### Task 1: Add failing map SVG contracts

**Files:**
- Modify: `scripts/verify-svg-usage.mjs`

- [ ] **Step 1: Read `MapSelect.jsx`**

Add `src/screens/MapSelect.jsx` to the verification script’s file inputs.

- [ ] **Step 2: Add two checks**

Require:

- `MapSelect` renders `src={uiSvg.time}` and no longer contains `◷`;
- `MapSelect` renders `HandDrawnLine` and no longer contains a 1px beige divider.

- [ ] **Step 3: Verify RED**

Run: `npm run svg:verify-usage`

Expected: both map checks fail because the screen still uses the glyph and straight dividers.

### Task 2: Reuse the registered SVGs

**Files:**
- Modify: `src/screens/MapSelect.jsx`

- [ ] **Step 1: Add imports**

```jsx
import { uiSvg } from '@assets/svg';
import HandDrawnLine from '@/components/HandDrawnLine';
```

- [ ] **Step 2: Replace the time glyph**

Replace the `◷` span inside each memo chip with:

```jsx
<img
  src={uiSvg.time}
  width={16}
  height={16}
  alt=""
  style={{ display: 'block', opacity: 0.58 }}
/>
```

Keep chip padding, gap, text, and mapping behavior unchanged.

- [ ] **Step 3: Replace the row dividers**

Replace each `height: 1` beige divider with:

```jsx
<HandDrawnLine
  color={palette.beige}
  width={362}
  height={12}
  style={{
    position: 'absolute',
    left: 20,
    top: rowTops[i] + rowHeights[i] - 6,
  }}
/>
```

The old divider y-coordinate becomes the new line’s vertical center.

- [ ] **Step 4: Verify GREEN**

Run: `npm run svg:verify-usage`

Expected: all usage checks pass.

### Task 3: Verify rendering

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

- [ ] **Step 2: Inspect the 402×874 map screen**

Confirm:

- both memo chips use complete, non-broken `time.svg` images at 16×16;
- the bottom sheet renders three 362×12 SVG masks;
- line centers match the former divider positions;
- place row click overlays still cover their full row.

## Repository Constraint

Do not commit or create a worktree: the repository has no baseline commit and commits require explicit user authorization.
