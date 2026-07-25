/**
 * 일반 UI SVG 등록 계약 검증.
 *
 * 파일 존재 여부뿐 아니라 24×24 viewBox, 중앙 index import, uiSvg 공개 key까지
 * 확인해 "파일만 복사되고 실제로 등록되지 않은" 상태를 방지한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SVG_ROOT = path.join(ROOT, 'design-assets/svg');
const INDEX_PATH = path.join(SVG_ROOT, 'index.js');

const expected = {
  camera: 'ui/camera.svg',
  cancelCircle: 'ui/cancelCircle.svg',
  cancel: 'ui/cancel.svg',
  circle: 'ui/circle.svg',
  expandDown: 'ui/expandDown.svg',
  expandLeft: 'ui/expandLeft.svg',
  expandRight: 'ui/expandRight.svg',
  expandUp: 'ui/expandUp.svg',
  heart: 'ui/heart.svg',
  heartFilled: 'ui/heartFilled.svg',
  homeSketch: 'ui/homeSketch.svg',
  calendar: 'ui/calendar.svg',
  crew: 'ui/crew.svg',
  home: 'ui/home.svg',
  log: 'ui/log.svg',
  minus: 'ui/minus.svg',
  myPage: 'ui/myPage.svg',
  people: 'ui/people.svg',
  plus: 'ui/plus.svg',
  mapSketch: 'ui/mapSketch.svg',
  pencil: 'etc/pencil.svg',
  plusSketch: 'ui/plusSketch.svg',
  profile: 'ui/profile.svg',
  arrowDown: 'ui/arrowDown.svg',
  arrowLeft: 'ui/arrowLeft.svg',
  arrowRight: 'ui/arrowRight.svg',
  arrowUp: 'ui/arrowUp.svg',
  schedule: 'etc/schedule.svg',
  search: 'ui/search.svg',
  time: 'ui/time.svg',
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const indexSource = fs.readFileSync(INDEX_PATH, 'utf8');
const uiSvgBlock = indexSource.match(/export const uiSvg = \{([\s\S]*?)\n\};/)?.[1] ?? '';
const errors = [];

for (const [key, relativePath] of Object.entries(expected)) {
  const absolutePath = path.join(SVG_ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    errors.push(`${relativePath}: 파일 없음`);
  } else {
    const svg = fs.readFileSync(absolutePath, 'utf8');
    if (!/viewBox="0 0 24 24"/.test(svg)) {
      errors.push(`${relativePath}: viewBox가 0 0 24 24가 아님`);
    }
  }

  const importPattern = new RegExp(
    `import\\s+${escapeRegex(key)}\\s+from\\s+['"]\\./${escapeRegex(relativePath)}['"]`,
  );
  if (!importPattern.test(indexSource)) {
    errors.push(`${key}: index.js import 누락 (${relativePath})`);
  }

  const exportPattern = new RegExp(`(?:^|[\\s,])${escapeRegex(key)}\\s*(?:,|:|$)`, 'm');
  if (!exportPattern.test(uiSvgBlock)) {
    errors.push(`${key}: uiSvg export 누락`);
  }
}

const expectedUiFiles = new Set(
  Object.values(expected)
    .filter((relativePath) => relativePath.startsWith('ui/'))
    .map((relativePath) => path.basename(relativePath)),
);
const uiDir = path.join(SVG_ROOT, 'ui');
if (fs.existsSync(uiDir)) {
  const actualUiFiles = fs.readdirSync(uiDir).filter((file) => file.endsWith('.svg'));
  for (const file of actualUiFiles) {
    if (!expectedUiFiles.has(file)) errors.push(`ui/${file}: uiSvg 등록 계약에 없는 파일`);
  }
}

for (const error of errors) console.error(`FAIL ${error}`);
console.log(`\n${Object.keys(expected).length}개 UI SVG, 실패 ${errors.length}개`);
process.exit(errors.length ? 1 : 0);
