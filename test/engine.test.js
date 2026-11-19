import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluate } from '../src/engine.js';
import { runEstimate } from '../src/estimate.js';
import { findDuplicates } from '../public/shared/dedupe.js';

const load = (f) => JSON.parse(fs.readFileSync(new URL(`../config/rulesets/${f}`, import.meta.url)));
const ST = load('sex_therapist.2026.T.1.json');
const SC = load('sexuality_counselor.2026.C.1.json');
const SE = load('sexuality_educator.2026.E.1.json');
const SETTINGS = { educationRatePerCeHour: 35, supervisionRatePerHour: 185, sarPrice: 650, priceRangeBuffer: 500, offerings: {} };
const CKA = 'ABCDEFGHIJKLMNOPQ'.split('');

let n = 0;
const course = (allocs, extra = {}) => ({
  id: `c${++n}`, kind: 'course', title: extra.title ?? `Course ${n}`, creditType: 'aasect_ce', delivery: 'synchronous',
  totalUnit: 'clock_hours', totalAmount: allocs.reduce((s, a) => s + (a.hours ?? 0), 0) || null,
  allocations: allocs.map((a) => ({ basis: 'stated', ...a })), source: { type: 'manual' }, ...extra,
});
const core = (area, hours, o = {}) => ({ requirement: 'core', area, hours, ...o });
const tr = (area, hours, o = {}) => ({ requirement: 'training', area, hours, ...o });
const fullCore = (per = 3) => CKA.map((a) => core(a, per));

test('overall total met but one domain short', () => {
  // 16 areas: A–F at 15h, G–O at 1–? ... build: A–P except G have >= 3, G has 0. Total >= 90.
  const allocs = CKA.filter((a) => a !== 'G').map((a, i) => core(a, i < 6 ? 10 : 4)); // 6*10 + 10*4 = 100
  const r = evaluate(ST, { entries: [course(allocs)] }).requirements.core;
  assert.equal(r.counted, 100);
  assert.equal(r.overallGap, 0);
  assert.equal(r.areaShortfallTotal, 3);
  assert.equal(r.remaining, 3, 'still needs 3 hours in area G even though 90 is exceeded');
  assert.deepEqual(r.areas.filter((a) => a.shortfall).map((a) => a.key), ['G']);
});

test('domain cap limits counted hours', () => {
  const allocs = [core('A', 50), ...CKA.slice(1).map((a) => core(a, 3))]; // A capped to 20; 20 + 48 = 68
  const r = evaluate(ST, { entries: [course(allocs)] }).requirements.core;
  const A = r.areas.find((a) => a.key === 'A');
  assert.equal(A.counted, 20);
  assert.equal(A.excessOverCap, 30);
  assert.equal(r.counted, 68);
  assert.equal(r.remaining, 22);
  assert.ok(r.flags.some((f) => f.type === 'cap'));
});

test('same additional hours satisfy domain minimum and overall minimum (counted once)', () => {
  // 80 counted, with area Q at 0 => area shortfall 3, overall gap 10. Need 10, not 13.
  const allocs = CKA.filter((a) => a !== 'Q').map((a, i) => core(a, i < 16 ? 5 : 0)); // 16*5 = 80
  const r = evaluate(ST, { entries: [course(allocs)] }).requirements.core;
  assert.equal(r.counted, 80);
  assert.equal(r.areaShortfallTotal, 3);
  assert.equal(r.overallGap, 10);
  assert.equal(r.remaining, 10);
  const est = runEstimate(ST, { entries: [course(allocs)], answers: { sarCompleted: 'no' } }, SETTINGS);
  const line = est.price.lines.find((l) => l.key === 'core');
  assert.equal(line.hours, 10);
  assert.match(est.public.checklist[0].text, /Core knowledge — 10 hours, including 3 hours in a Core Knowledge Area where the minimum/);
});

test('synchronous minimum is a separate floor that overlaps with other gaps', () => {
  const allocs = CKA.map((a) => core(a, 6)); // 102 hours but all async
  const r = evaluate(ST, { entries: [course(allocs, { delivery: 'asynchronous' })] }).requirements.core;
  assert.equal(r.overallGap, 0);
  assert.equal(r.syncShortfall, 15);
  assert.equal(r.remaining, 15);
});

test('syllabus topic without stated hours is left out and flagged', () => {
  const allocs = [...fullCore(5).filter((a) => a.area !== 'L'), core('L', null, { basis: 'unsure', topic: 'Substance use and sexuality' })];
  const r = evaluate(ST, { entries: [course(allocs)] }).requirements.core;
  assert.equal(r.areas.find((a) => a.key === 'L').counted, 0);
  assert.equal(r.remaining, Math.max(3, 90 - 80));
  assert.ok(r.flags.some((f) => f.type === 'unsure_hours' && /Substance use/.test(f.message)));
});

test('self-reported topic hours are used provisionally and labeled', () => {
  const allocs = [...fullCore(5).filter((a) => a.area !== 'L'), core('L', 4, { basis: 'self_reported' })];
  const r = evaluate(ST, { entries: [course(allocs)] }).requirements.core;
  assert.equal(r.areas.find((a) => a.key === 'L').counted, 4);
  assert.ok(r.flags.some((f) => f.type === 'self_reported'));
});

test('course appearing in upload and manual entry is counted once', () => {
  const doc = course([core('G', 12), core('H', 10)], { title: 'HSX 610 Human Sexual Anatomy and Health', provider: 'Northwest University', source: { type: 'document', fileName: 'transcript.pdf' } });
  const manual = course([core('G', 22)], { title: 'HSX 610 Sexual Anatomy', provider: 'Northwest University', source: { type: 'manual' } });
  const dupes = findDuplicates([doc, manual]);
  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].keepId, doc.id);
  const r = evaluate(ST, { entries: [doc, manual] }).requirements.core;
  assert.equal(r.areas.find((a) => a.key === 'G').counted, 12);
  // Student says they are different -> both count.
  manual.notDuplicateOf = [doc.id];
  const r2 = evaluate(ST, { entries: [doc, manual] }).requirements.core;
  assert.equal(r2.areas.find((a) => a.key === 'G').counted, 20);
});

test('semester credits convert at 15 clock hours, non-AASECT CE counts half', () => {
  const academic = course([core('A', 20), core('B', 20)], { creditType: 'academic', totalUnit: 'semester_credits', totalAmount: 3 });
  const nonAasect = course([core('C', 10)], { creditType: 'non_aasect_ce', totalUnit: 'ce_hours', totalAmount: 10 });
  const r = evaluate(ST, { entries: [academic, nonAasect] }).requirements.core;
  assert.equal(r.areas.find((a) => a.key === 'A').counted, 20);
  assert.equal(r.areas.find((a) => a.key === 'C').counted, 5);
  // Topic hours over the course total get scaled down.
  const over = course([core('D', 40), core('E', 20)], { creditType: 'academic', totalUnit: 'semester_credits', totalAmount: 3 });
  const r2 = evaluate(ST, { entries: [over] }).requirements.core;
  // D: 40h scaled to 30 (course total 45), then capped at 20; E: 15. Total 35.
  assert.equal(r2.counted, 35);
});

test('sex therapist couples counseling requirement overlaps with content area C', () => {
  const allocs = ['A', 'B', 'D', 'E', 'F'].map((a) => tr(a, 10)).concat(tr('C', 2)); // 52
  const e = course(allocs);
  const yes = evaluate(ST, { entries: [e], answers: { hasCouplesTraining: 'yes' } }).requirements.training;
  assert.equal(yes.remaining, 8); // C needs 1, total gap 8
  const no = evaluate(ST, { entries: [e], answers: { hasCouplesTraining: 'no' } }).requirements.training;
  assert.equal(no.conditional[0].shortfall, 16);
  assert.equal(no.areas.find((a) => a.key === 'C').neededInArea, 16);
  assert.equal(no.remaining, 16); // 16 couples hours in C also close the 8-hour total gap
});

test('counselor training requires 30 sexuality-specific hours', () => {
  const allocs = ['A', 'B', 'C', 'D', 'E', 'F'].map((a) => tr(a, 10, { sexualitySpecific: a === 'B' }));
  const r = evaluate(SC, { entries: [course(allocs)] }).requirements.training;
  assert.equal(r.counted, 60);
  assert.equal(r.specificShortfall, 20);
  assert.equal(r.remaining, 20);
});

test('supervision: individual minimum, group cap, non-qualifying and unsure hours', () => {
  const sup = (i, g, qualifies = 'yes') => ({ id: `s${++n}`, kind: 'supervision', supervisorName: `Sup ${n}`, individualHours: i, groupHours: g, qualifies });
  const r = evaluate(ST, { entries: [sup(10, 30), sup(5, 0, 'unsure'), sup(4, 0, 'no')] }).requirements.supervision;
  assert.equal(r.countedGroup, 25);
  assert.equal(r.counted, 35);
  assert.equal(r.individualShortfall, 15);
  assert.equal(r.remaining, 15);
  assert.equal(r.excludedHours, 9);
  const alt = evaluate(ST, { entries: [sup(10, 0)], answers: { tenYearsSexTherapy: 'yes' } }).requirements.supervision;
  assert.equal(alt.totalRequired, 25);
  assert.equal(alt.remaining, 15);
  const c = evaluate(SC, { entries: [sup(5, 25)] }).requirements.supervision;
  assert.equal(c.countedGroup, 15);
  assert.equal(c.remaining, 10);
  const e = evaluate(SE, { entries: [sup(0, 25)] }).requirements.supervision;
  assert.equal(e.countedGroup, 20);
  assert.equal(e.remaining, 5);
});

test('SAR statuses', () => {
  const sar = (hours, aasectApproved) => ({ id: `r${++n}`, kind: 'sar', title: 'SAR', hours, aasectApproved });
  assert.equal(evaluate(SE, { entries: [sar(14, 'yes')] }).requirements.sar.status, 'met');
  assert.equal(evaluate(SE, { entries: [sar(14, 'unsure')] }).requirements.sar.status, 'review');
  assert.equal(evaluate(SE, { entries: [], answers: { sarCompleted: 'no' } }).requirements.sar.status, 'outstanding');
  assert.equal(evaluate(SE, { entries: [], answers: { sarCompleted: 'unsure' } }).requirements.sar.status, 'review');
  assert.equal(evaluate(SE, { entries: [sar(10, 'yes')] }).requirements.sar.status, 'outstanding');
});

test('price range: ±buffer with $0 floor; public estimate exposes no rates', () => {
  const complete = [course(CKA.map((a) => core(a, 6))), course(['A', 'B', 'C', 'D', 'E', 'F'].map((a) => tr(a, 10)))];
  const sup = { id: 'sx', kind: 'supervision', supervisorName: 'X', individualHours: 1, groupHours: 0, qualifies: 'yes' };
  const intake = { entries: [...complete, sup, { id: 'sr', kind: 'sar', title: 'SAR', hours: 14, aasectApproved: 'yes' }], answers: { hasCouplesTraining: 'yes' } };
  const est = runEstimate(ST, intake, SETTINGS);
  // Supervision: 49 hours remaining is too much for this test; use a near-complete record.
  sup.individualHours = 49;
  const est2 = runEstimate(ST, intake, SETTINGS);
  assert.equal(est2.price.amount, 185); // 1 supervision hour
  assert.deepEqual(est2.price.range, { low: 0, high: 685 });
  assert.equal(est2.public.range.display, '$0–$685');
  const json = JSON.stringify(est2.public) + JSON.stringify(est.public);
  for (const leak of ['185', '"rate"', '"amount"', '"lines"', 'educationRate', 'supervisionRate', 'sarPrice']) assert.ok(!json.includes(leak), `public output leaks ${leak}`);
});

test('spec example: $6,000 calculated shows $5,500–$6,500', () => {
  // Remaining: core 20, training 12, supervision 15 hours, SAR outstanding.
  // 32 * 35 = 1120; 15 * 185 = 2775; total 3895 + SAR. Choose SAR price to hit 6000.
  const settings = { ...SETTINGS, sarPrice: 6000 - 1120 - 2775 };
  const coreAllocs = CKA.map((a, i) => core(a, i < 16 ? (i < 15 ? 4.4 : 4) : 0)); // 15*4.4 + 4 = 70; Q short by 3
  const trainAllocs = ['A', 'B', 'C', 'D', 'E', 'F'].map((a) => tr(a, 8)); // 48 -> 12 left
  const intake = {
    entries: [course(coreAllocs), course(trainAllocs), { id: 'sv', kind: 'supervision', supervisorName: 'Y', individualHours: 25, groupHours: 10, qualifies: 'yes' }],
    answers: { hasCouplesTraining: 'yes', sarCompleted: 'no' },
  };
  const est = runEstimate(ST, intake, settings);
  assert.equal(est.price.amount, 6000);
  assert.equal(est.public.range.display, '$5,500–$6,500');
  const texts = est.public.checklist.map((c) => c.text);
  assert.deepEqual(texts, [
    'Core knowledge — 20 hours, including 3 hours in a Core Knowledge Area where the minimum has not yet been met',
    'Sex therapy training — 12 hours',
    'Supervision — 15 hours',
    'SAR — Appears outstanding',
  ]);
});

test('requirements NWIOI does not offer are flagged outside NWIOI and not priced', () => {
  const settings = { ...SETTINGS, offerings: { sexuality_educator: { supervision: false } } };
  const est = runEstimate(SE, { entries: [], answers: { sarCompleted: 'no' } }, settings);
  assert.ok(!est.price.lines.some((l) => l.key === 'supervision'));
  assert.ok(est.public.outsideNwioi.some((o) => /Supervision — 25 hours/.test(o.label)));
});
