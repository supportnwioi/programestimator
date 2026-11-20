import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_CATALOG, trackEstimate, validateCatalog, benchmarks } from '../src/tracks.js';
import { isPlaceholderUrl, usableLink } from '../src/links.js';

const load = (f) => JSON.parse(fs.readFileSync(new URL(`../config/rulesets/${f}`, import.meta.url)));
const R = {
  sex_therapist: load('sex_therapist.2026.T.1.json'),
  sexuality_counselor: load('sexuality_counselor.2026.C.1.json'),
  sexuality_educator: load('sexuality_educator.2026.E.1.json'),
};
const PATHS = Object.keys(R);
const est = (path, input, opts = { preview: true }, catalog = DEFAULT_CATALOG) =>
  trackEstimate(catalog, R[path], { education: null, supervision: null, sar: null, supervisionWhere: null, coreSar: null, modular: {}, ...input }, opts);

test('catalog matches each credential’s active AASECT ruleset', () => {
  assert.deepEqual(validateCatalog(DEFAULT_CATALOG, R), []);
  assert.deepEqual(PATHS.map((p) => [benchmarks(R[p]).education, benchmarks(R[p]).supervision, benchmarks(R[p]).minMonths]), [[150, 50, 18], [150, 30, 12], [150, 25, 9]]);
});

test('validation catches curriculum or supervision that doesn’t fit the credential', () => {
  const bad = structuredClone(DEFAULT_CATALOG);
  bad.credentials.sexuality_counselor.comprehensive.curriculum[1].name = 'Sex therapy skills training';
  bad.credentials.sexuality_educator.comprehensive.supervision.groupHours = 24;
  bad.credentials.sex_therapist.comprehensive.minMonths = 12;
  const errors = validateCatalog(bad, R).join('\n');
  assert.match(errors, /sexuality_counselor: skills training must be "Sexuality Counseling Skills Training"/);
  assert.match(errors, /sexuality_educator: supervision package is 29 hours; target is 25/);
  assert.match(errors, /sex_therapist: minimum supervision period 12 months; AASECT requires 18/);
});

test('switching credentials changes the supervision package and tuition', () => {
  const tuition = PATHS.map((p) => est(p, {}).tracks.comprehensive.price.amount);
  assert.deepEqual(tuition, [8500, 7950, 7250]);
  const sup = PATHS.map((p) => est(p, {}).tracks.comprehensive.included.find((x) => x.startsWith('Supervision')));
  assert.match(sup[0], /26 individual hours and 24 group hours in twelve two-hour sessions \(over at least 18 months\)/);
  assert.match(sup[1], /15 individual hours and 15 group hours in five three-hour sessions with three supervisees \(over at least 12 months\)/);
  assert.match(sup[2], /Five individual hours with your primary supervisor and 20 group hours in ten two-hour sessions \(over at least 9 months\)/);
  assert.equal(est('sexuality_educator', {}).tracks.comprehensive.lead, 'Design and deliver a sexuality education program with feedback from an AASECT Certified Sexuality Educator Supervisor.');
  assert.ok(est('sex_therapist', {}).tracks.comprehensive.included.some((x) => /Sex therapy skills training/.test(x)));
  assert.ok(est('sexuality_educator', {}).tracks.comprehensive.included.some((x) => /Sexuality education skills training/.test(x)));
});

test('prior CEUs, prior supervision and a completed SAR never change fixed package tuition', () => {
  for (const p of PATHS) {
    const base = est(p, {}).tracks.comprehensive.price.amount;
    for (const education of [0, 25, 51, 99, 150, 'unsure', null]) for (const supervision of [0, 5, 25, 'unsure', null]) for (const sar of ['yes', 'no', 'unsure', null]) {
      const r = est(p, { education, supervision, sar, supervisionWhere: 'nwioi' });
      assert.equal(r.tracks.comprehensive.price.amount, base, `${p} ${education}/${supervision}/${sar}`);
      if (r.tracks.core) assert.ok([7350, 8000].includes(r.tracks.core.price.amount));
    }
  }
});

test('Therapist Core: draft $7,350 + $650 SAR = $8,000; SAR optional', () => {
  const r = est('sex_therapist', { education: 51, supervision: 0, sar: 'no', supervisionWhere: 'nwioi' });
  assert.equal(r.recommended, 'core');
  assert.equal(r.coreFit, true);
  assert.equal(r.tracks.core.price.amount, 8000);
  assert.equal(r.tracks.core.price.draft, true);
  assert.match(r.reasons[0], /^Core may be your fit/);
  assert.equal(est('sex_therapist', { education: 51, sar: 'no', coreSar: false }).tracks.core.price.amount, 7350);
  assert.equal(est('sex_therapist', { education: 51, sar: 'yes' }).tracks.core.price.amount, 7350, 'SAR not added when already completed');
  assert.equal(r.tracks.comprehensive.price.amount - r.tracks.core.price.amount, 500);
});

test('Core is suggested at about 51 prior CEUs only when the full supervision package is still needed', () => {
  assert.equal(est('sex_therapist', { education: 50, supervision: 0, supervisionWhere: 'nwioi' }).recommended, 'comprehensive');
  assert.equal(est('sex_therapist', { education: 51, supervision: 0, supervisionWhere: 'nwioi' }).recommended, 'core');
  assert.equal(est('sex_therapist', { education: 51, supervision: 30, supervisionWhere: 'nwioi' }).recommended, 'modular');
  assert.equal(est('sex_therapist', { education: 51, supervision: 0, supervisionWhere: 'outside' }).recommended, 'modular');
  assert.equal(est('sex_therapist', { education: 'unsure', supervision: 0, supervisionWhere: 'nwioi' }).recommended, 'comprehensive', 'unknown education never becomes a Core fit');
  // Counselor and Educator have no Core defined.
  for (const p of ['sexuality_counselor', 'sexuality_educator']) {
    const r = est(p, { education: 120, supervision: 0, supervisionWhere: 'nwioi' });
    assert.equal(r.tracks.core, null);
    assert.match(r.coreNotDefinedNote, /hasn’t defined a Core track/);
    assert.notEqual(r.recommended, 'core');
  }
});

test('Modular: $35 × CEUs plus selected add-ons', () => {
  const r = est('sex_therapist', { education: 70, supervision: 0, sar: 'no', supervisionWhere: 'outside' });
  assert.equal(r.tracks.modular.selection.ceus, 80);
  assert.equal(r.tracks.modular.price.amount, 3450, '80 CEUs + SAR');
  assert.equal(est('sex_therapist', { education: 70, sar: 'yes', supervisionWhere: 'outside' }).tracks.modular.price.amount, 2800, '80 CEUs');
  assert.equal(est('sexuality_educator', { education: 0, sar: 'no', supervisionWhere: 'outside' }).tracks.modular.price.amount, 5900, '150 CEUs + SAR');
  // The visitor can override the suggested quantity.
  assert.equal(est('sex_therapist', { education: 70, sar: 'no', supervisionWhere: 'outside', modular: { ceus: 150 } }).tracks.modular.price.amount, 5900);
});

test('outside supervision is left out of the Modular total and labeled', () => {
  const r = est('sex_therapist', { education: 70, supervision: 0, sar: 'no', supervisionWhere: 'outside', modular: { individualHours: 10, groupSessions: 4 } });
  assert.equal(r.tracks.modular.price.label, 'Your estimated cost with NWIOI');
  assert.equal(r.tracks.modular.price.amount, 3450);
  assert.ok(r.tracks.modular.notes.some((n) => /pay your supervisor separately/.test(n)));
  assert.ok(!r.tracks.modular.items.some((l) => /supervision/.test(l)));
});

test('Modular shows units only: no per-unit rates or per-line prices reach the browser', () => {
  const r = est('sexuality_counselor', { education: 120, supervision: 10, sar: 'no', supervisionWhere: 'nwioi' });
  const m = r.tracks.modular;
  assert.deepEqual(m.items, ['30 CEUs', 'SAR', '10 individual supervision hours', '4 group supervision sessions (3 hours each)']);
  const json = JSON.stringify(m);
  for (const leak of ['$35', '$195', '$200', '$650', '"rate', 'Rate', '"lines"', '"amount":1', '"amount":3', '"amount":6', '"amount":7']) assert.ok(!json.includes(leak), `leaks ${leak}`);
  assert.equal(Object.keys(m.price).includes('amount'), true);
  // Totals are rounded to the nearest $50, so one more CEU doesn't reveal the rate.
  const a = est('sex_therapist', { education: 70, sar: 'yes', supervisionWhere: 'outside', modular: { ceus: 80 } }).tracks.modular.price.amount;
  const b = est('sex_therapist', { education: 70, sar: 'yes', supervisionWhere: 'outside', modular: { ceus: 81 } }).tracks.modular.price.amount;
  assert.equal(a % 50, 0);
  assert.equal(b % 50, 0);
  assert.notEqual(b - a, 35, 'a one-CEU change does not reveal the per-CEU rate');
});

test('NWIOI supervision bought separately: individual hours and group sessions priced separately', () => {
  const r = est('sexuality_counselor', { education: 120, supervision: 10, sar: 'yes', supervisionWhere: 'nwioi' });
  const m = r.tracks.modular;
  assert.equal(m.price.label, 'NWIOI estimate');
  assert.deepEqual([m.selection.ceus, m.selection.individualHours, m.selection.groupSessions], [30, 10, 4]);
  assert.equal(m.price.amount, 30 * 35 + 10 * 195 + 4 * 200);
  assert.ok(m.items.includes('4 group supervision sessions (3 hours each)'));
});

test('unknown answers never silently become zero', () => {
  const r = est('sex_therapist', { education: 'unsure', supervision: 'unsure', sar: 'no', supervisionWhere: 'nwioi' });
  assert.equal(r.tracks.modular.selection.ceus, null);
  assert.equal(r.tracks.modular.selection.individualHours, null);
  assert.equal(r.tracks.modular.price.complete, false);
  assert.ok(r.tracks.modular.notes.some((n) => /weren’t sure about your education hours/.test(n)));
  assert.ok(r.notes.some((n) => /weren’t sure/.test(n)));
  const un = est('sex_therapist', { education: null, supervision: null });
  assert.equal(un.tracks.modular.selection.ceus, null);
  assert.ok(un.notes.some((n) => /Answer the questions/.test(n)));
  const zero = est('sex_therapist', { education: 0, supervision: 0, sar: 'no', supervisionWhere: 'nwioi' });
  assert.equal(zero.tracks.modular.selection.ceus, 150);
});

test('drafts are hidden publicly; approved offers and payment plans are shown', () => {
  const pub = est('sex_therapist', { education: 51, supervision: 0, sar: 'no' }, { preview: false });
  assert.equal(pub.tracks.comprehensive.price.amount, null);
  assert.equal(pub.tracks.comprehensive.price.confirmText, 'Confirm tuition with admissions');
  assert.equal(pub.tracks.core.price.confirmText, 'Confirm Core tuition with admissions');
  assert.equal(pub.tracks.modular.price.amount, null);
  assert.ok(!JSON.stringify(pub).includes('8,500') && !JSON.stringify(pub).includes('8500') && !JSON.stringify(pub).includes('7350'), 'no draft prices in the public payload');
  const cat = structuredClone(DEFAULT_CATALOG);
  Object.assign(cat.credentials.sexuality_educator.comprehensive, { status: 'approved', links: { enroll: 'https://nwioi-test.org/enroll', supervisors: '', sampleWeekend: '' }, paymentPlans: [{ label: '12 months', monthly: 625, months: 12, total: 7500, status: 'approved' }] });
  const ok = est('sexuality_educator', {}, { preview: false }, cat);
  assert.equal(ok.tracks.comprehensive.price.amount, 7250);
  assert.equal(ok.tracks.comprehensive.price.draft, false);
  assert.equal(ok.tracks.comprehensive.cta.link.url, 'https://nwioi-test.org/enroll');
  assert.equal(ok.tracks.comprehensive.paymentPlans[0].text, '$625/month for 12 months ($7,500 total)');
});

test('next steps match the recommended track', () => {
  const links = { booking: 'https://calendar.nwioi-test.org/admissions' };
  const comp = est('sex_therapist', { education: 0, supervision: 0, supervisionWhere: 'nwioi' }, { preview: true, links });
  assert.equal(comp.recommended, 'comprehensive');
  assert.equal(comp.tracks.comprehensive.cta.label, 'Explore enrollment');
  assert.equal(comp.tracks.comprehensive.cta.link.url, links.booking, 'no enrollment page yet, so it goes to admissions');
  assert.equal(comp.tracks.core.cta.label, 'Review my prior training');
  assert.equal(comp.tracks.modular.cta.label, 'Explore courses');
  assert.equal(comp.tracks.modular.secondary.label, 'Help me choose what I need');
});

test('placeholder links are never shown publicly', () => {
  assert.equal(isPlaceholderUrl('https://example.com/nwioi-admissions-calendar'), true);
  assert.equal(isPlaceholderUrl('mailto:admissions@example.org'), true);
  assert.equal(usableLink('https://example.com/x', false), null);
  assert.deepEqual(usableLink('https://example.com/x', true), { url: 'https://example.com/x', placeholder: true });
  assert.deepEqual(usableLink('https://student.nwioi.com/inquire', false), { url: 'https://student.nwioi.com/inquire', placeholder: false });
});
