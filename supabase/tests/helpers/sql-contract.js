/**
 * Static SQL contract reader for the Supabase migrations.
 *
 * The Supabase CLI and the Docker daemon are not available in this workspace, so
 * the executable guard for the schema is a *structural* contract over the
 * migration SQL rather than a live database run. This module tokenises the
 * migration files (dollar-quote and string aware) and exposes the declarations
 * the contract test asserts on.
 *
 * It is deliberately not a full SQL parser. It understands exactly the
 * statement shapes this project's migrations use.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const SUPABASE_DIR = join(HERE, '..', '..');
export const MIGRATIONS_DIR = join(SUPABASE_DIR, 'migrations');
export const TESTS_DIR = join(SUPABASE_DIR, 'tests');
export const SQL_TESTS_DIR = join(TESTS_DIR, 'sql');

/* ------------------------------------------------------------------ */
/* tokenising                                                          */
/* ------------------------------------------------------------------ */

const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/** Remove `--` and block comments while preserving string/dollar-quoted text. */
export function stripComments(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const rest = text.slice(i);
    if (rest.startsWith('--')) {
      const end = text.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }
    if (rest.startsWith('/*')) {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    const tag = DOLLAR_TAG.exec(rest);
    if (tag) {
      const end = text.indexOf(tag[0], i + tag[0].length);
      const stop = end === -1 ? n : end + tag[0].length;
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (text[j] === ch) {
          if (text[j + 1] === ch) {
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      out += text.slice(i, j);
      i = j;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * Split SQL into statements. Returns `{ raw, code }` per statement where `code`
 * has comments removed (including comments nested inside function bodies).
 */
export function parseSql(sql) {
  const out = [];
  let raw = '';
  let code = '';
  let i = 0;
  const n = sql.length;
  const push = () => {
    if (code.trim().length > 0) out.push({ raw: raw.trim(), code: code.trim() });
    raw = '';
    code = '';
  };
  while (i < n) {
    const rest = sql.slice(i);
    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      raw += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (rest.startsWith('/*')) {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      raw += sql.slice(i, stop);
      i = stop;
      continue;
    }
    const tag = DOLLAR_TAG.exec(rest);
    if (tag) {
      const end = sql.indexOf(tag[0], i + tag[0].length);
      const stop = end === -1 ? n : end + tag[0].length;
      const chunk = sql.slice(i, stop);
      raw += chunk;
      // Strip comments *inside* the body while keeping the delimiters. Passing
      // the whole chunk to stripComments would be a no-op, because it treats a
      // dollar-quoted region as opaque literal text — and then an assertion on a
      // function body could match a comment instead of real code.
      const head = tag[0].length;
      const tail = end === -1 ? chunk.length : chunk.length - tag[0].length;
      code +=
        chunk.slice(0, head) + stripComments(chunk.slice(head, tail)) + chunk.slice(tail);
      i = stop;
      continue;
    }
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) {
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      const chunk = sql.slice(i, j);
      raw += chunk;
      code += chunk;
      i = j;
      continue;
    }
    if (ch === ';') {
      raw += ch;
      push();
      i += 1;
      continue;
    }
    raw += ch;
    code += ch;
    i += 1;
  }
  push();
  return out;
}

/** Split on a top-level separator, honouring parens and quoted text. */
export function splitTopLevel(text, separator = ',') {
  const parts = [];
  let depth = 0;
  let buf = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    const tag = DOLLAR_TAG.exec(text.slice(i));
    if (tag) {
      const end = text.indexOf(tag[0], i + tag[0].length);
      const stop = end === -1 ? n : end + tag[0].length;
      buf += text.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (text[j] === ch) {
          if (text[j + 1] === ch) {
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      buf += text.slice(i, j);
      i = j;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (depth === 0 && ch === separator) {
      parts.push(buf.trim());
      buf = '';
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

/** Text between the first balanced pair of parentheses. */
export function balancedParens(text, fromIndex = 0) {
  const start = text.indexOf('(', fromIndex);
  if (start === -1) return null;
  let depth = 0;
  let i = start;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    const tag = DOLLAR_TAG.exec(text.slice(i));
    if (tag) {
      const end = text.indexOf(tag[0], i + tag[0].length);
      i = end === -1 ? n : end + tag[0].length;
      continue;
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (text[j] === ch) {
          if (text[j + 1] === ch) {
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      i = j;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return { start, end: i, body: text.slice(start + 1, i) };
    }
    i += 1;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* migration loading                                                   */
/* ------------------------------------------------------------------ */

export function migrationFiles() {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

export function sqlTestFiles() {
  if (!existsSync(SQL_TESTS_DIR)) return [];
  return readdirSync(SQL_TESTS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

let cache = null;

function load() {
  if (cache) return cache;
  const files = migrationFiles();
  const statements = [];
  let raw = '';
  for (const file of files) {
    const text = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    raw += `\n-- file: ${file}\n${text}`;
    for (const st of parseSql(text)) statements.push({ ...st, file });
  }
  cache = { files, statements, raw };
  return cache;
}

export function rawSql() {
  return load().raw;
}

export function statements() {
  return load().statements;
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();

function match(re) {
  return statements().filter((st) => re.test(norm(st.code)));
}

/* ------------------------------------------------------------------ */
/* declaration readers                                                 */
/* ------------------------------------------------------------------ */

const CONSTRAINT_HEADS = new Set([
  'primary',
  'unique',
  'foreign',
  'check',
  'constraint',
  'exclude',
  'like',
]);

export function createTables() {
  const tables = new Map();
  for (const st of statements()) {
    const m = /^create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_]+\.[a-z0-9_]+)/i.exec(
      norm(st.code),
    );
    if (!m) continue;
    const name = m[1].toLowerCase();
    const paren = balancedParens(st.code);
    const body = paren ? paren.body : '';
    const items = splitTopLevel(body, ',');
    const columns = new Map();
    const constraints = [];
    for (const item of items) {
      const head = item.split(/\s+/)[0].replace(/"/g, '').toLowerCase();
      if (CONSTRAINT_HEADS.has(head)) {
        constraints.push(norm(item));
      } else {
        columns.set(head, norm(item));
      }
    }
    tables.set(name, { name, file: st.file, code: st.code, body, columns, constraints });
  }
  return tables;
}

export function alterAddedColumns() {
  const added = new Map();
  for (const st of statements()) {
    const m =
      /^alter\s+table\s+(?:if\s+exists\s+)?([a-z0-9_]+\.[a-z0-9_]+)\s+([\s\S]+)$/i.exec(
        norm(st.code),
      );
    if (!m) continue;
    const name = m[1].toLowerCase();
    for (const action of splitTopLevel(m[2], ',')) {
      const col = /^add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z0-9_]+)\s+([\s\S]+)$/i.exec(
        action.trim(),
      );
      if (!col) continue;
      if (!added.has(name)) added.set(name, new Map());
      added.get(name).set(col[1].toLowerCase(), norm(action));
    }
  }
  return added;
}

/** Every column known for a table: CREATE TABLE body plus ALTER ... ADD COLUMN. */
export function tableColumns(name) {
  const key = name.toLowerCase();
  const base = createTables().get(key);
  const out = new Map(base ? base.columns : []);
  const extra = alterAddedColumns().get(key);
  if (extra) for (const [col, def] of extra) out.set(col, def);
  return out;
}

/** Whole-table SQL surface: CREATE TABLE plus its ALTER statements. */
export function tableSql(name) {
  const key = name.toLowerCase();
  return statements()
    .filter((st) => {
      const n = norm(st.code);
      return (
        new RegExp(`^create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${key}\\b`, 'i').test(n) ||
        new RegExp(`^alter\\s+table\\s+(?:if\\s+exists\\s+)?${key}\\b`, 'i').test(n)
      );
    })
    .map((st) => st.code)
    .join('\n');
}

export function rlsEnabledTables() {
  const out = new Set();
  for (const st of match(/^alter\s+table\s+[\s\S]*enable\s+row\s+level\s+security/i)) {
    const m = /^alter\s+table\s+(?:if\s+exists\s+)?([a-z0-9_]+\.[a-z0-9_]+)/i.exec(norm(st.code));
    if (m) out.add(m[1].toLowerCase());
  }
  return out;
}

export function policies() {
  const out = [];
  for (const st of statements()) {
    const n = norm(st.code);
    const m = /^create\s+policy\s+("?)([^"\s]+)\1\s+on\s+([a-z0-9_]+\.[a-z0-9_]+)([\s\S]*)$/i.exec(n);
    if (!m) continue;
    const tail = m[4];
    const split = /\b(using|with\s+check)\b/i.exec(tail);
    const head = split ? tail.slice(0, split.index) : tail;
    const cmd = /\bfor\s+(all|select|insert|update|delete)\b/i.exec(head);
    const roles = /\bto\s+([a-z0-9_,\s]+?)(?=\s*(using|with\s+check|as\b|$))/i.exec(head);
    out.push({
      name: m[2].toLowerCase(),
      table: m[3].toLowerCase(),
      command: (cmd ? cmd[1] : 'all').toLowerCase(),
      roles: roles
        ? roles[1]
            .split(',')
            .map((r) => r.trim().toLowerCase())
            .filter(Boolean)
        : [],
      expression: tail,
      code: st.code,
      file: st.file,
    });
  }
  return out;
}

export function policiesFor(table, command) {
  const key = table.toLowerCase();
  return policies().filter(
    (p) => p.table === key && (!command || p.command === command || p.command === 'all'),
  );
}

export function indexes() {
  const out = [];
  for (const st of statements()) {
    const n = norm(st.code);
    const m =
      /^create\s+(unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([a-z0-9_]+)\s+on\s+([a-z0-9_]+\.[a-z0-9_]+)([\s\S]*)$/i.exec(
        n,
      );
    if (!m) continue;
    const tail = m[4];
    const paren = balancedParens(tail);
    const where = /\bwhere\b([\s\S]*)$/i.exec(paren ? tail.slice(paren.end) : tail);
    out.push({
      name: m[2].toLowerCase(),
      unique: Boolean(m[1]),
      table: m[3].toLowerCase(),
      columns: paren
        ? splitTopLevel(paren.body, ',').map((c) => c.trim().toLowerCase())
        : [],
      where: where ? norm(where[1]) : null,
      code: n,
      file: st.file,
    });
  }
  return out;
}

export function functions() {
  const out = [];
  for (const st of statements()) {
    const n = norm(st.code);
    const m = /^create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_]+\.[a-z0-9_]+)\s*\(/i.exec(n);
    if (!m) continue;
    const args = balancedParens(n, m[0].length - 1);
    const afterArgs = args ? n.slice(args.end + 1) : n;
    const bodyStart = /\bas\s+\$/i.exec(afterArgs);
    const header = bodyStart ? afterArgs.slice(0, bodyStart.index) : afterArgs;
    const body = bodyStart ? afterArgs.slice(bodyStart.index) : '';
    const searchPath = /\bset\s+search_path\s*(?:=|to)\s*([^\s;]*)/i.exec(header);
    out.push({
      name: m[1].toLowerCase(),
      args: args ? args.body : '',
      header,
      body,
      code: st.code,
      file: st.file,
      securityDefiner: /\bsecurity\s+definer\b/i.test(header),
      searchPath: searchPath ? searchPath[1] : null,
      language: (/\blanguage\s+([a-z]+)/i.exec(header) || [null, null])[1],
    });
  }
  return out;
}

export function functionsNamed(name) {
  const key = name.toLowerCase();
  return functions().filter((f) => f.name === key);
}

function privilegeStatements(verb) {
  const out = [];
  const re = new RegExp(`^${verb}\\b`, 'i');
  for (const st of statements()) {
    const n = norm(st.code);
    if (!re.test(n)) continue;
    const roleRe = verb === 'grant' ? /\bto\s+([\s\S]+)$/i : /\bfrom\s+([\s\S]+)$/i;
    const roles = roleRe.exec(n);
    out.push({
      code: n,
      file: st.file,
      roles: roles
        ? roles[1]
            .split(',')
            .map((r) => r.trim().toLowerCase().replace(/;$/, ''))
            .filter(Boolean)
        : [],
    });
  }
  return out;
}

export function grants() {
  return privilegeStatements('grant');
}

export function revokes() {
  return privilegeStatements('revoke');
}

export function inserts() {
  const out = [];
  for (const st of statements()) {
    const n = norm(st.code);
    const m = /^insert\s+into\s+([a-z0-9_]+\.[a-z0-9_]+)/i.exec(n);
    if (!m) continue;
    out.push({ table: m[1].toLowerCase(), code: n, file: st.file });
  }
  return out;
}

/** All schema-qualified table names created by the migrations. */
export function createdTableNames() {
  return [...createTables().keys()];
}
