# Flower Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render all seven registered flower SVGs in the picker and make its initial, toggle, and null-save behavior follow the current record.

**Architecture:** Keep `FlowerPickSheet` presentational and let `BookmarkPick` derive the initial selection from the record store. Reuse the existing `FLOWERS`, `flowerSvg`, and `setRecordFlower` contracts; no new asset registry or API layer is needed.

**Tech Stack:** React 19, React Router 7, Vite, Node source-contract verification

---

### Task 1: Add failing flower picker usage contracts

**Files:**
- Modify: `scripts/verify-svg-usage.mjs`

- [ ] **Step 1: Load the picker and route sources**

```js
const flowerPickSheet = fs.readFileSync(
  path.join(ROOT, 'src/components/FlowerPickSheet.jsx'),
  'utf8',
);
const bookmarkPick = fs.readFileSync(
  path.join(ROOT, 'src/screens/BookmarkPick.jsx'),
  'utf8',
);
```

- [ ] **Step 2: Add contracts for original flower SVGs and selection state**

```js
{
  name: 'FlowerPickSheet: original flower SVGs',
  pass: /src=\{flowerSvg\[f\.key\]\}/.test(flowerPickSheet)
    && !/etcSvg\.ratingFlower/.test(flowerPickSheet),
},
{
  name: 'FlowerPickSheet: selected flower toggles to null',
  pass: /onSelect\(active\s*\?\s*null\s*:\s*f\.key\)/.test(flowerPickSheet),
},
{
  name: 'BookmarkPick: derives initial selection from current record',
  pass: /\buseRecord\(recordId\)/.test(bookmarkPick)
    && /\bFLOWERS\.some\(/.test(bookmarkPick)
    && /useState\(\(\)\s*=>/.test(bookmarkPick),
},
{
  name: 'BookmarkPick: null selection can be confirmed',
  pass: /if\s*\(saving\)\s*return/.test(bookmarkPick)
    && !/if\s*\(!selected\s*\|\|\s*saving\)/.test(bookmarkPick)
    && /setRecordFlower\(recordId,\s*selected\)/.test(bookmarkPick),
},
```

- [ ] **Step 3: Run the contracts and observe the expected failure**

Run: `npm run svg:verify-usage`

Expected: FAIL for original flower SVGs, record-derived initial selection, and null confirmation. The existing toggle contract may already pass.

### Task 2: Render registered original flower assets

**Files:**
- Modify: `src/components/FlowerPickSheet.jsx`

- [ ] **Step 1: Replace the generic icon imports**

```jsx
import { flowerSvg, svgSize } from '@assets/svg';
```

Remove `etcSvg` and `MaskIcon`.

- [ ] **Step 2: Render the keyed original SVG**

```jsx
<img
  src={flowerSvg[f.key]}
  {...svgSize[f.key]}
  alt=""
  style={{ display: 'block', marginTop: 4, objectFit: 'contain' }}
/>
```

Remove the separately drawn tape because it is already included in each original flower asset.

- [ ] **Step 3: Run the usage contracts**

Run: `npm run svg:verify-usage`

Expected: the original flower SVG contract passes; state-flow contracts still fail.

### Task 3: Initialize from the record and save deselection

**Files:**
- Modify: `src/screens/BookmarkPick.jsx`

- [ ] **Step 1: Read the current record and known flower keys**

```jsx
import { FLOWERS } from '@/data/fixtures';
import { useApp, useRecord } from '@/data/store';

const record = useRecord(recordId);
const [selected, setSelected] = useState(() => (
  FLOWERS.some((flower) => flower.key === record?.flower) ? record.flower : null
));
```

- [ ] **Step 2: Preserve the missing-record guard**

When the app is ready and the record does not exist, redirect safely. Before readiness, render nothing.

- [ ] **Step 3: Allow `null` to be saved**

```jsx
if (saving) return;
await setRecordFlower(recordId, selected);
```

The existing API already accepts and persists `null`.

- [ ] **Step 4: Keep the confirmation button usable for a null selection**

Use the olive button when idle and only show the disabled color while `saving`.

- [ ] **Step 5: Keep state on save failure**

Wrap saving in `try/catch/finally`, retain `selected`, expose a short retry message, and clear it before each retry.

- [ ] **Step 6: Run the usage contracts**

Run: `npm run svg:verify-usage`

Expected: all flower picker contracts pass.

### Task 4: Full verification

**Files:**
- Verify only

- [ ] **Step 1: Verify all registered SVG files**

Run: `npm run svg:verify`

Expected: 51 SVG files, 0 failures.

- [ ] **Step 2: Verify UI SVG rules**

Run: `npm run svg:verify-ui`

Expected: 29 UI SVGs, 0 failures.

- [ ] **Step 3: Verify screen usage contracts**

Run: `npm run svg:verify-usage`

Expected: all checks pass.

- [ ] **Step 4: Build production output**

Run: `npm run build`

Expected: Vite build exits with code 0.

- [ ] **Step 5: Visually inspect both entry states**

Open a record with `flower: null` and confirm no card is selected. Open a record with a flower key, confirm that flower is selected, then click it again and confirm the selection clears and saves.

### Repository note

Do not commit these changes unless the user explicitly requests a commit. The repository currently has no baseline commit and its project instructions reserve commits for explicit user requests.
