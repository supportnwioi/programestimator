// Ruleset lifecycle: check the official sources for published changes, create a
// draft for NWIOI to review, validate it, and approve it for new estimates.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod/v4';
import { rulesets, checks, ROOT, DATA } from './store.js';
import { extractRequirementsText, findRequirementsVersion, hashText, lineDiff } from './sourceText.js';

const Area = z.object({ key: z.string().min(1), label: z.string().min(1), timeSensitive: z.boolean().optional() });
const HoursReq = z.object({
  key: z.string(), kind: z.literal('hours'), label: z.string(), totalHours: z.number().positive(), synchronousMin: z.number().min(0),
  areaMin: z.number().min(0), areaMax: z.number().positive(), areas: z.array(Area).min(1), specificMin: z.number().min(0).nullable().optional(),
  conditional: z.array(z.object({ key: z.string(), label: z.string(), hours: z.number().positive(), area: z.string(), question: z.string(), appliesWhen: z.string() })).optional(),
}).loose();
const SupReq = z.object({ key: z.literal('supervision'), kind: z.literal('supervision'), totalHours: z.number().positive(), individualMin: z.number().min(0), groupMax: z.number().min(0), minMonths: z.number().min(0) }).loose();
const SarReq = z.object({ key: z.literal('sar'), kind: z.literal('sar'), hours: z.number().positive() }).loose();
const Ruleset = z.object({
  id: z.string(), path: z.enum(['sex_therapist', 'sexuality_counselor', 'sexuality_educator']), pathName: z.string(), credential: z.string(), version: z.string().min(1),
  status: z.enum(['draft', 'approved', 'retired']),
  sources: z.array(z.object({ title: z.string(), url: z.url(), retrievedAt: z.string(), contentHash: z.string().nullable() }).loose()).min(1),
  creditRules: z.object({ academicSemesterCreditClockHours: z.number().positive(), academicMultiplier: z.number(), aasectCeMultiplier: z.number(), nonAasectCeMultiplier: z.number() }).loose(),
  requirements: z.array(z.union([HoursReq, SupReq, SarReq])).min(1),
  terms: z.object({ supervisorTitle: z.string() }).loose(),
}).loose();

export function validateRuleset(r) {
  const res = Ruleset.safeParse(r);
  const errors = res.success ? [] : res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  for (const req of r.requirements || []) {
    if (req.kind === 'hours' && req.areaMin * (req.areas?.length || 0) > req.totalHours) errors.push(`${req.key}: area minimums exceed total hours`);
    if (req.kind === 'hours' && req.areaMax * (req.areas?.length || 0) < req.totalHours) errors.push(`${req.key}: area caps make the total unreachable`);
    if (req.kind === 'supervision' && req.individualMin + req.groupMax < req.totalHours) errors.push('supervision: individual minimum + group maximum is less than total');
  }
  if (!['core', 'training', 'supervision', 'sar'].every((k) => r.requirements?.some((q) => q.key === k))) errors.push('requirements must include core, training, supervision and sar');
  return errors;
}

function snapshotText(src) {
  if (src.snapshotFile?.startsWith('data:')) return checks.readText(src.snapshotFile.slice(5));
  try { return fs.readFileSync(path.join(ROOT, src.snapshotFile), 'utf8'); } catch { return null; }
}

export async function checkForChanges(fetchImpl = fetch) {
  const results = [];
  for (const [pathKey, id] of Object.entries(rulesets.activeIds())) {
    const r = rulesets.get(id);
    for (const src of r.sources) {
      try {
        const res = await fetchImpl(src.url, { headers: { 'user-agent': 'NWIOI-estimator-requirements-check/1.0' }, signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = extractRequirementsText(await res.text());
        const hash = hashText(text);
        const foundVersion = findRequirementsVersion(text);
        const changed = hash !== src.contentHash || (foundVersion && foundVersion !== r.version);
        const entry = { path: pathKey, rulesetId: id, url: src.url, status: changed ? 'changed' : 'unchanged', storedVersion: r.version, foundVersion, storedHash: src.contentHash, foundHash: hash, checkedAt: new Date().toISOString() };
        if (changed) {
          entry.textFile = checks.saveText(pathKey, text);
          const prev = snapshotText(src);
          entry.diff = prev ? lineDiff(prev, text) : [{ op: 'note', text: 'No stored snapshot to compare against.' }];
          entry.versionChanged = Boolean(foundVersion && foundVersion !== r.version);
        }
        results.push(entry);
      } catch (err) {
        results.push({ path: pathKey, rulesetId: id, url: src.url, status: 'error', error: String(err.message || err), checkedAt: new Date().toISOString() });
      }
    }
  }
  const out = { checkedAt: new Date().toISOString(), results };
  checks.save(out);
  return out;
}

export function createDraft(pathKey, adminUser) {
  const active = rulesets.active(pathKey);
  if (!active) throw new Error('No active ruleset for this path');
  const check = checks.get().results.find((c) => c.path === pathKey && c.status === 'changed');
  const version = check?.foundVersion && check.foundVersion !== active.version ? check.foundVersion : `${active.version}-draft${Date.now().toString(36)}`;
  const draft = structuredClone(active);
  Object.assign(draft, {
    id: `${pathKey}@${version}`, version, status: 'draft', enabled: active.enabled,
    basedOn: active.id, createdAt: new Date().toISOString(), createdBy: adminUser, approvedAt: null, approvedBy: null, verifiedAt: null,
    reviewNotes: check ? `Draft created after a published change was detected on ${check.checkedAt}. Review the diff and update the requirements before approving.` : 'Manual draft.',
  });
  if (check) draft.sources = draft.sources.map((s) => s.url === check.url ? { ...s, contentHash: check.foundHash, requirementsVersion: check.foundVersion, retrievedAt: check.checkedAt.slice(0, 10), snapshotFile: `data:${check.textFile}` } : s);
  rulesets.save(draft);
  return draft;
}

export function updateDraft(id, body) {
  const existing = rulesets.get(id);
  if (!existing || existing.status !== 'draft') throw new Error('Only drafts can be edited');
  const next = { ...body, id: existing.id, path: existing.path, status: 'draft', basedOn: existing.basedOn, createdAt: existing.createdAt, createdBy: existing.createdBy };
  const errors = validateRuleset(next);
  rulesets.save(next);
  return { ruleset: next, errors };
}

export function approveDraft(id, adminUser, { verifiedAgainstSource }) {
  const r = rulesets.get(id);
  if (!r || r.status !== 'draft') throw new Error('Only drafts can be approved');
  if (!verifiedAgainstSource) throw new Error('Confirm that the draft was verified against the official source before approving.');
  const errors = validateRuleset({ ...r, status: 'approved' });
  if (errors.length) { const e = new Error('Draft is not valid'); e.details = errors; throw e; }
  const prev = rulesets.active(r.path);
  const now = new Date().toISOString();
  Object.assign(r, { status: 'approved', approvedAt: now, approvedBy: adminUser, verifiedAt: now.slice(0, 10) });
  rulesets.save(r);
  if (prev && prev.id !== r.id) { prev.status = 'retired'; prev.retiredAt = now; rulesets.save(prev); }
  rulesets.setActive(r.path, r.id);
  return r;
}

export function setEnabled(pathKey, enabled) {
  const r = rulesets.active(pathKey);
  if (!r) throw new Error('No active ruleset');
  if (enabled && (r.status !== 'approved' || !r.verifiedAt)) throw new Error('A path can only be enabled once its ruleset is verified and approved.');
  r.enabled = Boolean(enabled);
  rulesets.save(r);
  return r;
}

export { DATA };
