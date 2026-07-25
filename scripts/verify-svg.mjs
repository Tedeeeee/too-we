/**
 * design-assets/svg 검증 — import-figma-svg.mjs 실행 후 반드시 돌릴 것.
 *
 *   node scripts/verify-svg.mjs [dir]
 *
 * 이관 스크립트가 정규식으로 노드를 지우기 때문에 다음이 깨질 수 있다:
 *  - 태그 균형 (닫히지 않은 요소, 짝이 안 맞는 닫는 태그)
 *  - url(#id) 참조가 지워진 정의를 가리킴
 *  - base64 텍스처 잔존
 *
 * 또한 svgSize와 실제 viewBox가 어긋나면 절대 좌표 레이아웃에서 비율이 깨지므로
 * index.js의 svgSize와 대조한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = process.argv[2] || path.join(ROOT, 'design-assets/svg');

/** 원본이 항상 self-close로 쓰는 요소 — 열린 채 남아있으면 이상 신호 */
const VOID_OK = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'use', 'image', 'stop']);

function checkBalance(svg) {
  const errors = [];
  const stack = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClose] = m;
    if (closing) {
      const top = stack.pop();
      if (top !== name) errors.push(`</${name}> 위치에서 기대값 </${top ?? '없음'}>`);
    } else if (!selfClose) {
      if (VOID_OK.has(name)) errors.push(`<${name}>가 self-close되지 않음`);
      stack.push(name);
    }
  }
  if (stack.length) errors.push(`닫히지 않은 태그: ${stack.join(' > ')}`);
  return errors;
}

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.svg')) files.push(p);
  }
})(DIR);

// index.js의 svgSize를 파싱해 viewBox와 대조 (import 없이 텍스트로 읽는다)
const indexPath = path.join(DIR, 'index.js');
const declared = new Map();
if (fs.existsSync(indexPath)) {
  const src = fs.readFileSync(indexPath, 'utf8');
  const block = src.match(/export const svgSize = \{([\s\S]*?)\n\};/)?.[1] ?? '';
  for (const m of block.matchAll(/(\w+):\s*\{\s*width:\s*(\d+),\s*height:\s*(\d+)\s*\}/g)) {
    declared.set(m[1], `${m[2]}x${m[3]}`);
  }
}
/** 파일 stem -> svgSize key (index.js의 명명과 맞춘다) */
const SIZE_KEY = {
  'note2-2': 'note2b',
  'rose-head': 'roseHead',
  'flower-blank': 'flowerBlank',
  'memo-note': 'memoNote',
  'rating-flower': 'ratingFlower',
  'schedule-color': 'scheduleColor',
  'line-long': 'lineLong',
  'line-short': 'lineShort',
  flowers: 'flowersIllust',
};

let bad = 0;
for (const p of files.sort()) {
  const rel = path.relative(DIR, p).replace(/\\/g, '/');
  const svg = fs.readFileSync(p, 'utf8');
  const errs = checkBalance(svg);

  if (!/^<svg\b/.test(svg.trim())) errs.push('<svg>로 시작하지 않음');
  if (!/<\/svg>\s*$/.test(svg)) errs.push('</svg>로 끝나지 않음');
  if (/base64/.test(svg)) errs.push('base64 텍스처 잔존');
  if (/url\(#pattern/.test(svg)) errs.push('제거된 pattern을 아직 참조');
  if (/xlink:href/.test(svg) && !/xmlns:xlink/.test(svg)) errs.push('xlink:href는 있는데 xmlns:xlink 없음');

  const defined = new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map((x) => x[1]));
  for (const r of svg.matchAll(/url\(#([^)]+)\)/g)) {
    if (!defined.has(r[1])) errs.push(`정의되지 않은 참조 url(#${r[1]})`);
  }

  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const actual = vb ? `${Math.round(Number(vb[1]))}x${Math.round(Number(vb[2]))}` : '?';
  const stem = path.basename(rel, '.svg');
  const key = SIZE_KEY[stem] || stem;
  const want = declared.get(key);
  if (want && want !== actual) errs.push(`svgSize.${key}=${want} 인데 viewBox는 ${actual} — index.js 갱신 필요`);
  if (!want && declared.size) errs.push(`index.js svgSize에 '${key}' 항목이 없음`);

  if (errs.length) bad++;
  console.log(`${rel.padEnd(26)} ${actual.padEnd(9)} ${(fs.statSync(p).size + 'B').padEnd(8)} ${errs.length ? 'FAIL  ' + errs.join(' | ') : 'ok'}`);
}

console.log(`\n${files.length}개 파일, 실패 ${bad}개`);
if (bad) console.log('실패 항목을 고친 뒤 `npx vite build` 로 import 해석까지 확인할 것.');
process.exit(bad ? 1 : 0);
