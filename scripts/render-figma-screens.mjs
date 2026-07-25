/**
 * Figma 화면을 PNG로 렌더해 받아온다 (재실행 가능).
 *
 *   node scripts/render-figma-screens.mjs [--scale 1] [--only 208:1452,209:1924] [--list]
 *
 * MCP는 Starter 플랜 호출 제한에 걸리므로 REST를 쓴다. 토큰은 `.figma-token`
 * (gitignore됨)에서 읽는다. 만료되면 사용자가 재발급해 그 파일에 덮어쓴다.
 *
 * 화면 목록을 하드코딩하지 않고 매번 파일 트리에서 찾는다 — 디자인이 재편돼
 * node id가 바뀌어도 그대로 동작한다. SECTION 안의 프레임을 화면으로 간주한다.
 *
 * --list  는 렌더 없이 화면 목록만 출력한다(호출 절약).
 * --scale 1 은 대조용, 3 은 에셋 복원용.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE_KEY = 'SwPUTjl7rMmD61ELwMRFjC';
const OUT_DIR = path.join(ROOT, '.figma-renders');

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const SCALE = arg('scale', '1');
const ONLY = arg('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const LIST_ONLY = argv.includes('--list');

const tokenPath = path.join(ROOT, '.figma-token');
if (!fs.existsSync(tokenPath)) {
  console.error(`토큰 파일이 없습니다: ${tokenPath}\nFigma 개인 액세스 토큰(File content: Read-only)을 이 파일에 저장하세요.`);
  process.exit(1);
}
const TOKEN = fs.readFileSync(tokenPath, 'utf8').trim();

async function figma(urlPath) {
  const res = await fetch(`https://api.figma.com/v1/${urlPath}`, { headers: { 'X-Figma-Token': TOKEN } });
  if (res.status === 403) throw new Error('403 — 토큰이 만료되었거나 권한이 없습니다. 재발급해 .figma-token에 덮어쓰세요.');
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${urlPath}`);
  return res.json();
}

/** SECTION을 재귀로 훑어 화면(FRAME)을 모은다 */
function collectFrames(node, sectionPath, out) {
  for (const c of node.children || []) {
    if (c.type === 'SECTION') collectFrames(c, [...sectionPath, c.name], out);
    else if (c.type === 'FRAME') {
      const b = c.absoluteBoundingBox;
      out.push({
        id: c.id,
        name: c.name,
        section: sectionPath.join(' / '),
        width: b ? Math.round(b.width) : 0,
        height: b ? Math.round(b.height) : 0,
      });
    }
  }
}

const file = await figma(`files/${FILE_KEY}?depth=2`);
console.log(`파일: ${file.name}`);
console.log(`마지막 수정: ${file.lastModified}  (version ${file.version})\n`);

// 최상위 SECTION만 화면 컨테이너로 본다. 안쪽은 nodes 호출로 한 번 더 펼친다.
const topSections = (file.document.children || []).flatMap((page) =>
  (page.children || []).filter((c) => c.type === 'SECTION').map((s) => s.id),
);
const expanded = await figma(`files/${FILE_KEY}/nodes?ids=${topSections.join(',')}&depth=3`);

const screens = [];
for (const wrap of Object.values(expanded.nodes)) {
  collectFrames(wrap.document, [wrap.document.name], screens);
}
screens.sort((a, b) => a.section.localeCompare(b.section) || a.id.localeCompare(b.id));

console.log(`화면 ${screens.length}개`);
let lastSection = '';
for (const s of screens) {
  if (s.section !== lastSection) {
    console.log(`\n  [${s.section}]`);
    lastSection = s.section;
  }
  console.log(`    ${s.id.padEnd(12)} ${`${s.width}x${s.height}`.padEnd(10)} ${s.name}`);
}

if (LIST_ONLY) {
  console.log('\n--list 이므로 렌더하지 않았습니다.');
  process.exit(0);
}

const targets = ONLY.length ? screens.filter((s) => ONLY.includes(s.id)) : screens;
if (!targets.length) {
  console.error(`\n--only 로 지정한 id를 찾지 못했습니다: ${ONLY.join(', ')}`);
  process.exit(1);
}

console.log(`\n렌더 ${targets.length}개 (scale=${SCALE}) → ${OUT_DIR}`);
const { images } = await figma(`images/${FILE_KEY}?ids=${targets.map((t) => t.id).join(',')}&format=png&scale=${SCALE}`);

fs.mkdirSync(OUT_DIR, { recursive: true });
const index = [];
for (const t of targets) {
  const url = images[t.id];
  if (!url) {
    console.log(`  ${t.id}  렌더 실패 (null)`);
    continue;
  }
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const file = `${t.id.replace(':', '_')}.png`;
  fs.writeFileSync(path.join(OUT_DIR, file), buf);
  index.push({ ...t, file });
  console.log(`  ${file.padEnd(16)} ${(buf.length / 1024).toFixed(0)}KB  ${t.section} / ${t.name}`);
}

fs.writeFileSync(
  path.join(OUT_DIR, 'index.json'),
  JSON.stringify({ fileKey: FILE_KEY, lastModified: file.lastModified, scale: Number(SCALE), screens: index }, null, 2),
);
console.log(`\nindex.json 기록 완료. .figma-renders/ 는 gitignore 대상이다(언제든 재생성 가능).`);
