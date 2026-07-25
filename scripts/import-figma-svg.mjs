/**
 * Figma 익스포트 SVG 이관 스크립트 (재실행 가능).
 *
 *   node scripts/import-figma-svg.mjs [--src <dir>] [--out <dir>] [--dry]
 *
 * 기본 소스는 couple-place-diary(Next.js 버전)의 public/svg — 그쪽이 Figma 개인 액세스
 * 토큰으로 직접 익스포트한 원본 도착지다. Figma MCP에 일일 무료 제한이 있어 이 경로를 쓴다.
 *
 * 하는 일:
 *  1) base64로 박힌 종이 질감 텍스처 제거 (Figma가 파일마다 중복 삽입한다)
 *  2) 파일명을 src/data/fixtures.js의 FLOWERS key에 맞게 재매핑
 *  3) 제거 전후 용량과, 텍스처가 실제로 보이는 영역 크기를 리포트
 *
 * 왜 텍스처를 지우는가: 390×582 PNG(342,801B)가 꽃 8개 + flower-blank + sticker에
 * 전부 동일하게 들어있는데(md5 일치), pattern이 413×617 박스를 채우고 clipPath가
 * 28.5×8.2px 띠만 남긴다. 즉 이미지 중 27×8px 크롭만 보인다. 216픽셀을 위해 257KB.
 * 테이프 띠 자체는 벡터(fill="#AC8641")로 남으므로 사라지는 건 미세한 그레인뿐.
 * 원본 텍스처는 design-assets/images/paper-texture.png에 보존돼 있다.
 *
 * 이관 후 반드시 `node scripts/verify-svg.mjs` 로 검증할 것 — 정규식으로 노드를
 * 지우기 때문에 태그 균형이나 url(#id) 참조가 깨질 수 있다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const DRY = argv.includes('--dry');
const SRC = arg('src', 'C:/couple/product/couple-place-diary/public/svg');
const OUT = arg('out', path.join(ROOT, 'design-assets/svg'));

/** couple2의 fixtures.js FLOWERS key에 맞춘 파일명 재매핑 */
const RENAME = {
  'flowers/Calendula.svg': 'flowers/marigold.svg', // 금잔화 = Calendula
  'flowers/Calla Lily.svg': 'flowers/calla.svg', // 공백이 URL에서 %20으로 깨짐
  'flowers/Forget-me-not.svg': 'flowers/forgetmenot.svg',
  'flowers/Jasmine.svg': 'flowers/jasmine.svg',
};

/** Next.js 기본 템플릿 에셋 — 프로젝트 디자인이 아니므로 제외 */
const SKIP = new Set(['file.svg', 'globe.svg', 'window.svg']);

if (!fs.existsSync(SRC)) {
  console.error(`소스를 찾을 수 없음: ${SRC}\n--src 로 경로를 지정하세요.`);
  process.exit(1);
}

const files = [];
for (const group of fs.readdirSync(SRC)) {
  const dir = path.join(SRC, group);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.svg') && !SKIP.has(f)) files.push(`${group}/${f}`);
  }
}
if (!files.length) {
  console.error(`${SRC} 아래에서 SVG를 찾지 못했습니다.`);
  process.exit(1);
}

const num = (tag, attr) => Number(tag.match(new RegExp(`\\b${attr}="([\\d.]+)"`))?.[1] ?? NaN);
const rows = [];

for (const rel of files) {
  let svg = fs.readFileSync(path.join(SRC, rel), 'utf8');
  const before = Buffer.byteLength(svg);

  // --- 분석: 텍스처 크기와, clipPath가 실제로 남기는 가시 영역 ---
  const textures = [...svg.matchAll(/<image\b[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"[^>]*\/>/g)].map(
    (m) => `${m[1]}x${m[2]}`,
  );
  const visible = [...svg.matchAll(/<clipPath\b[^>]*>\s*<rect\b[^>]*\/>\s*<\/clipPath>/g)]
    .map((m) => `${num(m[0], 'width').toFixed(1)}x${num(m[0], 'height').toFixed(1)}`)
    .filter((v, i, a) => a.indexOf(v) === i);

  // --- 제거: 텍스처 관련 노드만 ---
  svg = svg.replace(/<rect\b[^>]*fill="url\(#pattern[^)"]*\)"[^>]*\/>\s*/g, '');
  svg = svg.replace(/<pattern\b[^>]*>[\s\S]*?<\/pattern>\s*/g, '');
  svg = svg.replace(/<image\b[^>]*\/>\s*/g, '');
  svg = svg.replace(/<defs>\s*<\/defs>\s*/g, '');
  if (!/xlink:href/.test(svg)) svg = svg.replace(/\s+xmlns:xlink="[^"]*"/, '');

  if (/base64/.test(svg)) throw new Error(`base64가 남아있음: ${rel}`);

  const outRel = RENAME[rel] || rel;
  if (!DRY) {
    const outPath = path.join(OUT, outRel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, svg);
  }

  rows.push({
    rel,
    outRel,
    before,
    after: Buffer.byteLength(svg),
    viewBox: svg.match(/viewBox="([^"]+)"/)?.[1] ?? '?',
    texture: textures.join(',') || '-',
    visible: visible.join(',') || '-',
  });
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`소스: ${SRC}`);
console.log(`대상: ${OUT}${DRY ? '  (--dry: 기록하지 않음)' : ''}\n`);
console.log(pad('source', 26) + pad('-> out', 24) + pad('viewBox', 14) + pad('before', 9) + pad('after', 8) + pad('texture', 9) + '가시영역');
console.log('-'.repeat(104));
let tb = 0;
let ta = 0;
for (const r of rows) {
  tb += r.before;
  ta += r.after;
  console.log(
    pad(r.rel, 26) + pad(r.outRel, 24) + pad(r.viewBox, 14) + pad(r.before, 9) + pad(r.after, 8) + pad(r.texture, 9) + r.visible,
  );
}
console.log('-'.repeat(104));
console.log(`${rows.length}개 파일  ${tb} -> ${ta} bytes  (${((ta / tb) * 100).toFixed(1)}%)`);
console.log('\nviewBox가 바뀐 파일이 있으면 design-assets/svg/index.js의 svgSize를 갱신할 것.');
console.log('다음: node scripts/verify-svg.mjs');
