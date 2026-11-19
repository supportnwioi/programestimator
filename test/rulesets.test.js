import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NWIOI_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nwioi-rules-'));
const store = await import('../src/store.js');
const admin = await import('../src/rulesetAdmin.js');
store.init();

const snapshot = fs.readFileSync(new URL('../config/source-snapshots/sex_therapist.txt', import.meta.url), 'utf8');
const toHtml = (text) => `<html><body><nav>menu</nav><main>${text.split('\n').map((l) => `<p>${l}</p>`).join('')}</main></body></html>`;

test('unchanged published pages are detected as unchanged', async () => {
  const fetchSame = async (url) => {
    const key = Object.entries({ sex_therapist: 'sex-therapist', sexuality_counselor: 'counselor', sexuality_educator: 'educator' }).find(([, v]) => url.includes(v))[0];
    return new Response(toHtml(fs.readFileSync(new URL(`../config/source-snapshots/${key}.txt`, import.meta.url), 'utf8')));
  };
  const res = await admin.checkForChanges(fetchSame);
  assert.deepEqual(res.results.map((r) => r.status), ['unchanged', 'unchanged', 'unchanged']);
});

test('a published change creates a reviewable draft that must be approved before use', async () => {
  const changed = snapshot.replace('Requirements version: 2026.T.1', 'Requirements version: 2027.T.1').replace('fifteen (15) hours must be earned through synchronous', 'twenty (20) hours must be earned through synchronous');
  const fetchChanged = async (url) => new Response(toHtml(url.includes('sex-therapist') ? changed : fs.readFileSync(new URL(`../config/source-snapshots/${url.includes('counselor') ? 'sexuality_counselor' : 'sexuality_educator'}.txt`, import.meta.url), 'utf8')));
  const res = await admin.checkForChanges(fetchChanged);
  const st = res.results.find((r) => r.path === 'sex_therapist');
  assert.equal(st.status, 'changed');
  assert.equal(st.foundVersion, '2027.T.1');
  assert.ok(st.diff.some((d) => d.op === 'added' && /twenty \(20\)/.test(d.text)));

  const draft = admin.createDraft('sex_therapist', 'Tester');
  assert.equal(draft.id, 'sex_therapist@2027.T.1');
  assert.equal(draft.status, 'draft');
  assert.equal(store.rulesets.active('sex_therapist').version, '2026.T.1', 'active ruleset unchanged until approval');

  // Admin edits the structured rule, then approval requires explicit source verification.
  const edited = structuredClone(draft);
  edited.requirements.find((r) => r.key === 'core').synchronousMin = 20;
  const { errors } = admin.updateDraft(draft.id, edited);
  assert.deepEqual(errors, []);
  assert.throws(() => admin.approveDraft(draft.id, 'Tester', {}), /verified against the official source/);
  const approved = admin.approveDraft(draft.id, 'Tester', { verifiedAgainstSource: true });
  assert.equal(approved.status, 'approved');
  assert.equal(store.rulesets.active('sex_therapist').id, 'sex_therapist@2027.T.1');
  assert.equal(store.rulesets.get('sex_therapist@2026.T.1').status, 'retired');
});

test('invalid drafts cannot be approved', () => {
  const draft = admin.createDraft('sexuality_counselor', 'Tester');
  const bad = structuredClone(draft);
  bad.requirements.find((r) => r.key === 'core').areaMax = 1; // caps make 90 unreachable
  admin.updateDraft(draft.id, bad);
  assert.throws(() => admin.approveDraft(draft.id, 'Tester', { verifiedAgainstSource: true }), (e) => e.details?.some((d) => /unreachable/.test(d)));
});

test('a path cannot be enabled without an approved, verified ruleset', () => {
  admin.setEnabled('sexuality_educator', false);
  assert.equal(store.rulesets.active('sexuality_educator').enabled, false);
  admin.setEnabled('sexuality_educator', true);
  const r = store.rulesets.active('sexuality_educator');
  r.verifiedAt = null;
  store.rulesets.save(r);
  assert.throws(() => admin.setEnabled('sexuality_educator', true), /verified and approved/);
});
