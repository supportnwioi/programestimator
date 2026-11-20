// File-backed storage for the proof of concept (JSON files under NWIOI_DATA_DIR).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const DATA = path.resolve(process.env.NWIOI_DATA_DIR || path.join(ROOT, 'data'));
const p = (...xs) => path.join(DATA, ...xs);

export const newId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export const DEFAULT_SETTINGS = {
  educationRatePerCeHour: 35,
  supervisionRatePerHour: 185,
  sarPrice: 650,
  priceRangeBuffer: 500,
  schedulingUrl: 'https://example.com/nwioi-admissions-calendar',
  contactUrl: 'mailto:admissions@example.org?subject=Question%20about%20my%20NWIOI%20estimate',
  offerings: {
    sex_therapist: { core: true, training: true, supervision: true, sar: true },
    sexuality_counselor: { core: true, training: true, supervision: true, sar: true },
    sexuality_educator: { core: true, training: true, supervision: true, sar: true },
  },
  updatedAt: null,
  updatedBy: null,
};

export function init() {
  fs.mkdirSync(p('rulesets'), { recursive: true });
  if (!fs.existsSync(p('settings.json'))) writeJson(p('settings.json'), DEFAULT_SETTINGS);
  if (!fs.existsSync(p('active-rulesets.json'))) {
    const active = {};
    for (const f of fs.readdirSync(path.join(ROOT, 'config/rulesets'))) {
      const r = readJson(path.join(ROOT, 'config/rulesets', f));
      writeJson(p('rulesets', `${r.id.replace('@', '.')}.json`), r);
      active[r.path] = r.id;
    }
    writeJson(p('active-rulesets.json'), active);
  }
}

export const settings = {
  get: () => ({ ...DEFAULT_SETTINGS, ...readJson(p('settings.json'), {}) }),
  save: (s) => writeJson(p('settings.json'), s),
};

export const rulesets = {
  all: () => fs.readdirSync(p('rulesets')).filter((f) => f.endsWith('.json')).map((f) => readJson(p('rulesets', f))),
  get: (id) => readJson(p('rulesets', `${id.replace('@', '.')}.json`), null),
  save: (r) => writeJson(p('rulesets', `${r.id.replace('@', '.')}.json`), r),
  activeIds: () => readJson(p('active-rulesets.json'), {}),
  active(pathKey) { const id = this.activeIds()[pathKey]; return id ? this.get(id) : null; },
  setActive(pathKey, id) { const a = this.activeIds(); a[pathKey] = id; writeJson(p('active-rulesets.json'), a); },
};

export const estimates = {
  add(rec) { fs.mkdirSync(DATA, { recursive: true }); fs.appendFileSync(p('estimates.jsonl'), JSON.stringify(rec) + '\n'); },
  all() {
    try { return fs.readFileSync(p('estimates.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
  },
  get(id) { return this.all().find((e) => e.id === id) ?? null; },
};

export const shares = {
  dir: (id) => p('shares', id),
  save(rec) { writeJson(p('shares', rec.id, 'share.json'), rec); },
  saveFile(id, name, buf) { const safe = name.replace(/[^\w.\- ]/g, '_').slice(0, 120); fs.writeFileSync(p('shares', id, safe), buf); return safe; },
  all() {
    try { return fs.readdirSync(p('shares')).map((d) => readJson(p('shares', d, 'share.json'))).filter(Boolean); } catch { return []; }
  },
  filePath(id, name) { return p('shares', path.basename(id), path.basename(name)); },
};

// Track catalog (tiers, tuition, curriculum, links). Seeded from config/tracks.json.
export const tracks = {
  get: () => readJson(p('tracks.json'), null) ?? readJson(path.join(ROOT, 'config/tracks.json'), null),
  save: (v) => writeJson(p('tracks.json'), v),
};

export const checks = {
  get: () => readJson(p('source-checks.json'), { checkedAt: null, results: [] }),
  save: (v) => writeJson(p('source-checks.json'), v),
  saveText(pathKey, text) { const f = p('source-checks', `${pathKey}-${Date.now()}.txt`); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return path.relative(DATA, f); },
  readText: (rel) => { try { return fs.readFileSync(path.join(DATA, rel), 'utf8'); } catch { return null; } },
};
