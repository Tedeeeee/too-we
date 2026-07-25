# Onboarding Hand-Drawn Lines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three onboarding flows’ rigid separators with reusable, naturally curved hand-drawn SVG lines.

**Architecture:** Add long and short source SVGs to the existing onboarding asset registry. Render them through one small `HandDrawnLine` component that uses the external SVG as a CSS mask, allowing the screens to keep their current state-dependent colors without duplicating assets.

**Tech Stack:** React 19, Vite, external SVG assets, inline styles, Node verification scripts, Playwright browser verification

---

## File Structure

- Create `design-assets/svg/onboarding/line-long.svg`: long natural curve source.
- Create `design-assets/svg/onboarding/line-short.svg`: short input-segment curve source.
- Modify `design-assets/svg/index.js`: import, export, and size metadata for both assets.
- Create `src/components/HandDrawnLine.jsx`: colorable external-SVG mask renderer.
- Modify `src/screens/OnboardingName.jsx`: replace the rotated straight line.
- Modify `src/screens/OnboardingCode.jsx`: replace six rotated straight segments.
- Modify `src/screens/OnboardingShare.jsx`: replace the dashed divider.
- Modify `scripts/verify-svg-usage.mjs`: enforce asset and screen usage contracts.

### Task 1: Add a failing SVG usage contract

**Files:**
- Modify: `scripts/verify-svg-usage.mjs`

- [ ] **Step 1: Read the asset registry and line component**

Add file reads for `design-assets/svg/index.js` and `src/components/HandDrawnLine.jsx`, allowing a missing component to resolve as an empty string during the RED phase.

- [ ] **Step 2: Add checks for the desired implementation**

Verify:

- `lineLong` and `lineShort` exist in `onboardingSvg`.
- `HandDrawnLine` references both registered assets and uses `maskImage`.
- all three onboarding screens render `HandDrawnLine`.
- `OnboardingName` no longer uses the rotated 2px straight divider.
- `OnboardingCode` no longer declares `SEG_ROTS`.
- `OnboardingShare` no longer uses the dashed divider.

- [ ] **Step 3: Run the contract and verify RED**

Run: `npm run svg:verify-usage`

Expected: FAIL only for the new hand-drawn-line checks because the assets and component do not exist yet.

### Task 2: Add and register the source SVGs

**Files:**
- Create: `design-assets/svg/onboarding/line-long.svg`
- Create: `design-assets/svg/onboarding/line-short.svg`
- Modify: `design-assets/svg/index.js`

- [ ] **Step 1: Create the long source**

Use a transparent `358×12` viewBox and this deterministic natural curve:

```svg
<svg width="358" height="12" viewBox="0 0 358 12" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M1 6C14 3.5 25 8 41 5.5C58 3.5 70 8 88 5C105 3.2 119 8.4 137 5.3C155 3.4 169 7.7 186 5C203 2.8 219 8.2 236 5.4C254 3.6 270 7.7 287 5.2C305 3.2 324 8.1 357 5.5" stroke="black" stroke-width="1.8" stroke-linecap="round"/>
</svg>
```

- [ ] **Step 2: Create the short source**

Use a transparent `51×10` viewBox:

```svg
<svg width="51" height="10" viewBox="0 0 51 10" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M1 5C9 2.9 17 7.4 25 4.6C33 2.9 41 7.1 50 4.8" stroke="black" stroke-width="1.8" stroke-linecap="round"/>
</svg>
```

- [ ] **Step 3: Register the assets**

Import both files in `design-assets/svg/index.js`, add `lineLong` and `lineShort` to `onboardingSvg`, and add sizes `{ width: 358, height: 12 }` and `{ width: 51, height: 10 }` to `svgSize`.

- [ ] **Step 4: Verify the source files**

Run: `npm run svg:verify`

Expected: both new files print `ok`; total file count increases from 45 to 47 with zero failures.

### Task 3: Build the reusable renderer

**Files:**
- Create: `src/components/HandDrawnLine.jsx`

- [ ] **Step 1: Implement the minimal component**

Select the source and intrinsic size from the `variant` prop:

```jsx
const lineVariants = {
  long: { src: onboardingSvg.lineLong, size: svgSize.lineLong },
  short: { src: onboardingSvg.lineShort, size: svgSize.lineShort },
};
```

Render an `aria-hidden` span whose background is `color` and whose `maskImage` and `WebkitMaskImage` are the selected external SVG URL. Support `width`, `height`, and `style` props, with intrinsic sizes as defaults.

- [ ] **Step 2: Run the usage contract**

Run: `npm run svg:verify-usage`

Expected: asset/component checks pass; screen integration and legacy-removal checks still fail.

### Task 4: Integrate all onboarding screens

**Files:**
- Modify: `src/screens/OnboardingName.jsx`
- Modify: `src/screens/OnboardingCode.jsx`
- Modify: `src/screens/OnboardingShare.jsx`

- [ ] **Step 1: Replace the name divider**

Import `HandDrawnLine` and render the long variant at `left: 22`, `top: 493`, `width: 358`, `height: 12`, using `palette.textMuted`. This preserves the old line’s center at approximately y=499.

- [ ] **Step 2: Replace the six code segments**

Remove `SEG_ROTS`. Keep the existing six-column flex container and input-state calculation, but render `HandDrawnLine variant="short"` in each column. Use `palette.text` for filled/current states and `palette.beige` for idle states.

- [ ] **Step 3: Replace the share divider**

Render the long variant at the old divider center using `left: 28`, `top: 246`, `width: 275`, `height: 12`, and `palette.beige`.

- [ ] **Step 4: Verify GREEN**

Run: `npm run svg:verify-usage`

Expected: all usage checks pass with zero failures.

### Task 5: Verify build and rendered screens

**Files:**
- No production file changes expected.

- [ ] **Step 1: Run complete static verification**

Run:

```text
npm run svg:verify-usage
npm run svg:verify
npm run build
```

Expected: zero usage failures, 47 SVG files with zero failures, and a successful Vite production build.

- [ ] **Step 2: Inspect the 402×874 onboarding screens**

Start Vite and use Playwright with Edge to capture:

- `/onboarding/name`
- `/onboarding/code`
- `/onboarding/share`

Confirm the lines are naturally curved, remain aligned with their former center positions, show correct active/idle colors, and do not overlap text or counters.

- [ ] **Step 3: Check runtime assets**

Confirm every rendered `<img>` is complete with non-zero `naturalWidth`, and inspect the CSS-mask elements for resolved mask URLs.

## Repository Constraint

Do not create commits: `CLAUDE.md` explicitly says commits are allowed only when the user asks for them, and the repository currently has no baseline commit.
