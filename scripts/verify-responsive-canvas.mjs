import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const app = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'src/index.css'), 'utf8');
const mobileStage = css.match(/\.stage\.is-mobile\s*\{([\s\S]*?)\}/)?.[1] ?? '';

const checks = [
  {
    name: 'mobile canvas reads viewport height',
    pass: /const\s+vh\s*=\s*window\.innerHeight/.test(app),
  },
  {
    name: 'mobile canvas fits both viewport axes',
    pass: /Math\.min\(\s*vw\s*\/\s*layout\.width,\s*vh\s*\/\s*layout\.height\s*\)/.test(app),
  },
  {
    name: 'mobile stage is pinned to the viewport',
    pass: /position:\s*fixed/.test(mobileStage)
      && /inset:\s*0/.test(mobileStage)
      && /width:\s*100vw/.test(mobileStage)
      && /height:\s*100dvh/.test(mobileStage),
  },
  {
    name: 'mobile stage clips document overflow',
    pass: /overflow:\s*hidden/.test(mobileStage),
  },
];

const failures = checks.filter((check) => !check.pass);
for (const failure of failures) console.error(`FAIL ${failure.name}`);
console.log(`\n${checks.length} responsive canvas checks, ${failures.length} failures`);
process.exit(failures.length ? 1 : 0);
