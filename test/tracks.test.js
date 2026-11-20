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
  trackEstimate(catalog, R[path], { core: null, skills: null, supervision: null, sar: null, supervisionWhere: null, coreSar: null, modular: {}, ...input }, opts);
// A full set of answers (recommendation ready).
const full = (o = {}) => ({ core: 0, skills: 0, supervision: 0, sar: 'no', supervisionWhere: 'nwioi', ...o });

test('catalog matches each credential’s AASECT ruleset: 90 core + 60 skills, supervision 50/30/25', () => {
  assert.deepEqual(validateCatalog(DEFAULT_CATALOG, R), []);
  assert.deepEqual(PATHS.map((p) => { const b = benchmarks(R[p]); return [b.core, b.skills, b.supervision, b.minMonths]; }), [[90, 60, 50, 18], [90, 60, 30, 12], [90, 60, 25, 9]]);
  assert.deepEqual(PATHS.map((p) => benchmarks(R[p]).trainingLabel), ['Sex Therapy Skills Training', 'Sexuality Counseling Skills Training', 'Sexuality Education Skills Training']);
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

test('“Recommended for you” only once the answers support it', () => {
  const none = est('sex_therapist', {});
  assert.equal(none.recommended, null);
  assert.equal(none.startingPoint, 'comprehensive', 'shows the complete program as a starting point');
  assert.equal(none.reasons.length, 0);
  assert.match(none.notes[0], /Answer the questions to see which track fits/);
  // Hours answered but supervision location not yet: still not a recommendation.
  assert.equal(est('sex_therapist', { core: 10, skills: 0, supervision: 0, sar: 'no' }).recommended, null);
  // Location answered but an hours question unanswered: still not a recommendation.
  assert.equal(est('sex_therapist', { core: 10, supervision: 0, supervisionWhere: 'nwioi' }).recommended, null);
  assert.equal(est('sex_therapist', full()).recommended, 'comprehensive');
  // Outside supervision alone is enough to recommend Modular.
  assert.equal(est('sex_therapist', { supervisionWhere: 'outside' }).recommended, 'modular');
});

test('switching credentials changes the supervision package and standard tuition; pay in full saves 7%', () => {
  const r = PATHS.map((p) => est(p, {}).tracks.comprehensive.price);
  assert.deepEqual(r.map((p) => p.amount), [8500, 7950, 7250]);
  assert.deepEqual(r.map((p) => p.label), ['Standard NWIOI tuition', 'Standard NWIOI tuition', 'Standard NWIOI tuition']);
  assert.deepEqual(r.map((p) => [p.payInFull.display, p.payInFull.savings]), [['$7,905.00', '$595.00'], ['$7,393.50', '$556.50'], ['$6,742.50', '$507.50']]);
  const sup = PATHS.map((p) => est(p, {}).tracks.comprehensive.included.find((x) => x.startsWith('Supervision')));
  assert.match(sup[0], /26 individual hours and 24 group hours in twelve two-hour sessions/);
  assert.match(sup[1], /15 individual hours and 15 group hours in five three-hour sessions with three supervisees/);
  assert.match(sup[2], /Five individual hours with your primary supervisor and 20 group hours in ten two-hour sessions/);
  assert.equal(est('sexuality_educator', {}).tracks.comprehensive.lead, 'Design and deliver a sexuality education program with feedback from an AASECT Certified Sexuality Educator Supervisor.');
});

test('prior CEUs, supervision and SAR never change fixed package tuition', () => {
  for (const p of PATHS) {
    const base = est(p, {}).tracks.comprehensive.price.amount;
    for (const core of [0, 40, 90, 'unsure', null]) for (const skills of [0, 30, 60, 'unsure', null]) for (const supervision of [0, 10, 'unsure', null]) for (const sar of ['yes', 'no', 'unsure', null]) {
      const r = est(p, { core, skills, supervision, sar, supervisionWhere: 'nwioi' });
      assert.equal(r.tracks.comprehensive.price.amount, base, `${p} ${core}/${skills}/${supervision}/${sar}`);
      if (r.tracks.core) assert.ok([7350, 8000].includes(r.tracks.core.price.amount));
    }
  }
});

test('draft Therapist Core: $7,350 + $650 SAR = $8,000; paid in full with SAR = $7,485.50', () => {
  const r = est('sex_therapist', full({ core: 40, skills: 11 }));
  assert.equal(r.recommended, 'core');
  assert.match(r.reasons[0], /^Core may be your fit\. You’ve completed about 51 hours of education that may apply \(40 core knowledge \+ 11 skills training\)/);
  const p = r.tracks.core.price;
  assert.equal(p.amount, 8000);
  assert.equal(p.draft, true);
  assert.equal(p.payInFull.amount, 7485.5, 'Core tuition × 0.93 + full-price SAR');
  assert.equal(p.payInFull.display, '$7,485.50');
  const noSar = est('sex_therapist', full({ core: 40, skills: 11, sar: 'yes' })).tracks.core.price;
  assert.deepEqual([noSar.amount, noSar.payInFull.display, noSar.payInFull.savings], [7350, '$6,835.50', '$514.50']);
  // SAR “not sure” or unanswered: offered, not added until selected.
  assert.equal(est('sex_therapist', full({ core: 40, skills: 11, sar: 'unsure' })).tracks.core.price.amount, 7350);
  assert.equal(est('sex_therapist', full({ core: 40, skills: 11, sar: 'unsure', coreSar: true })).tracks.core.price.amount, 8000);
  assert.equal(est('sex_therapist', full({ core: 40, skills: 10 })).recommended, 'comprehensive', '50 hours is below the Core cue');
});

test('Core is not suggested on unknown education, outside supervision, or for credentials without Core', () => {
  assert.notEqual(est('sex_therapist', full({ core: 60, skills: 'unsure' })).recommended, 'core');
  assert.equal(est('sex_therapist', full({ core: 60, skills: 10, supervisionWhere: 'outside' })).recommended, 'modular');
  for (const p of ['sexuality_counselor', 'sexuality_educator']) {
    const r = est(p, full({ core: 80, skills: 40 }));
    assert.equal(r.tracks.core, null);
    assert.match(r.coreNotDefinedNote, /hasn’t defined a Core track/);
    assert.notEqual(r.recommended, 'core');
  }
});

test('Modular: each education category on its own; one exact total; quantities only', () => {
  const r = est('sex_therapist', full({ core: 80, skills: 30, sar: 'yes', supervisionWhere: 'outside' }));
  const m = r.tracks.modular;
  assert.deepEqual([m.suggestion.coreCeus, m.suggestion.skillsCeus], [10, 30]);
  assert.equal(m.price.amount, 1400, '10 core + 30 skills = 40 CEUs × $35');
  assert.equal(m.price.label, 'Estimated cost with NWIOI');
  assert.deepEqual(m.items, ['10 Core Knowledge CEUs', '30 Sex Therapy Skills Training CEUs']);
  assert.equal(m.basedOn, 'Based on the courses you’d buy individually from NWIOI through Tier III · Modular.');
  // Extra core hours can’t close the skills gap (core capped at 90, skills at 60).
  const over = est('sex_therapist', full({ core: 90, skills: 0, sar: 'yes', supervisionWhere: 'outside', modular: { coreCeus: 200 } })).tracks.modular;
  assert.deepEqual([over.selection.coreCeus, over.selection.skillsCeus], [90, 60]);
  // 80 CEUs = $2,800; with SAR $3,450; no rounding (e.g. 81 CEUs = $2,835).
  const eighty = (sar, extra = {}) => est('sex_therapist', full({ core: 30, skills: 40, sar, supervisionWhere: 'outside', ...extra })).tracks.modular.price.amount;
  assert.equal(eighty('yes'), 2800);
  assert.equal(eighty('no'), 3450);
  assert.equal(est('sex_therapist', full({ core: 30, skills: 40, sar: 'yes', supervisionWhere: 'outside', modular: { coreCeus: 61 } })).tracks.modular.price.amount, 2835);
  assert.equal(est('sexuality_educator', full({ supervisionWhere: 'outside' })).tracks.modular.price.amount, 5900, '150 CEUs + SAR');
});

test('Modular SAR: “Add SAR for $650 if needed” when unanswered or unsure; added only when selected', () => {
  const unsure = est('sex_therapist', full({ core: 30, skills: 40, sar: 'unsure', supervisionWhere: 'outside' })).tracks.modular;
  assert.equal(unsure.sarOffer, 'Add SAR for $650 if needed');
  assert.equal(unsure.selection.sar, false);
  assert.equal(unsure.price.amount, 2800);
  assert.equal(est('sex_therapist', full({ core: 30, skills: 40, sar: 'unsure', supervisionWhere: 'outside', modular: { sar: true } })).tracks.modular.price.amount, 3450);
  assert.equal(est('sex_therapist', { core: 30, skills: 40, supervisionWhere: 'outside' }).tracks.modular.sarOffer, 'Add SAR for $650 if needed');
  assert.equal(est('sex_therapist', full({ sar: 'yes', supervisionWhere: 'outside' })).tracks.modular.sarOffer, null);
});

test('unknown categories stay unresolved: the known portion is shown with what needs review', () => {
  const m = est('sex_therapist', full({ core: 80, skills: 'unsure', sar: 'yes', supervisionWhere: 'outside' })).tracks.modular;
  assert.equal(m.selection.skillsCeus, null);
  assert.equal(m.price.amount, 350, 'known core portion only');
  assert.equal(m.price.complete, false);
  assert.ok(m.notes.some((n) => /Sex Therapy Skills Training hours still need review/.test(n)));
  const un = est('sex_therapist', { supervisionWhere: 'outside' }).tracks.modular;
  assert.deepEqual([un.selection.coreCeus, un.selection.skillsCeus], [null, null]);
  const zero = est('sex_therapist', full({ supervisionWhere: 'outside' })).tracks.modular;
  assert.deepEqual([zero.selection.coreCeus, zero.selection.skillsCeus], [90, 60]);
});

test('outside supervision is left out of the Modular total', () => {
  const r = est('sex_therapist', full({ core: 30, skills: 40, sar: 'no', supervisionWhere: 'outside', modular: { individualHours: 10, groupSessions: 4 } }));
  assert.equal(r.tracks.modular.price.amount, 3450);
  assert.ok(r.tracks.modular.notes.includes('You’ll pay your outside supervisor separately.'));
  assert.ok(!r.tracks.modular.items.some((l) => /supervision/.test(l)));
  assert.equal(r.tracks.modular.basedOn, 'Based on the courses and SAR you’d buy individually from NWIOI through Tier III · Modular.', 'SAR mentioned only when included');
});

test('NWIOI supervision bought separately: individual hours and group sessions at their own rates', () => {
  const r = est('sexuality_counselor', full({ core: 80, skills: 40, supervision: 10, sar: 'yes' }));
  const m = r.tracks.modular;
  assert.deepEqual([m.selection.coreCeus, m.selection.skillsCeus, m.selection.individualHours, m.selection.groupSessions], [10, 20, 10, 4]);
  assert.equal(m.price.amount, 30 * 35 + 10 * 195 + 4 * 200);
  assert.ok(m.items.includes('4 group supervision sessions, 3 hours each'));
  assert.ok(m.items.includes('10 hours of individual supervision'));
});

test('screenshot scenario: $10,695 with quantities only; no unit prices or line amounts sent', () => {
  const r = est('sex_therapist', full({ core: 35, skills: 0, supervision: 0, sar: 'yes', supervisionWhere: 'nwioi' }));
  const m = r.tracks.modular;
  assert.equal(m.price.display, '$10,695');
  assert.deepEqual(m.items, ['55 Core Knowledge CEUs', '60 Sex Therapy Skills Training CEUs', '26 hours of individual supervision', '8 group supervision sessions, 3 hours each']);
  assert.equal(m.basedOn, 'Based on the courses and supervision you’d buy individually from NWIOI through Tier III · Modular.');
  const json = JSON.stringify(m);
  assert.deepEqual(json.match(/\$[0-9,.]+/g), ['$10,695'], 'the total is the only dollar figure in the Modular payload');
  for (const leak of ['"math"', '"amount":"$', 'educationSubtotal', '× $']) assert.ok(!json.includes(leak), `leaks ${leak}`);
  // With the SAR added, the sentence mentions it.
  const withSar = est('sex_therapist', full({ core: 35, skills: 0, supervision: 0, sar: 'no', supervisionWhere: 'nwioi' })).tracks.modular;
  assert.equal(withSar.price.display, '$11,345');
  assert.equal(withSar.basedOn, 'Based on the courses, supervision and SAR you’d buy individually from NWIOI through Tier III · Modular.');
});

test('drafts and placeholder links are hidden publicly; approved offers, plans and scholarship show', () => {
  const pub = est('sex_therapist', full({ core: 40, skills: 11 }), { preview: false });
  assert.equal(pub.tracks.comprehensive.price.confirmText, 'Confirm tuition with admissions');
  assert.equal(pub.tracks.core.price.confirmText, 'Confirm Core tuition with admissions');
  assert.equal(pub.tracks.modular.price.amount, null);
  const json = JSON.stringify(pub);
  for (const leak of ['8,500', '7,905', '7,350', '7,485', '$35', '$195']) assert.ok(!json.includes(leak), `public payload leaks ${leak}`);
  assert.equal(pub.scholarship.application.url, 'https://forms.wix.com/f/7167298250691576552', 'scholarship application is a real, approved link');
  const cat = structuredClone(DEFAULT_CATALOG);
  Object.assign(cat.credentials.sexuality_educator.comprehensive, { status: 'approved', links: { enroll: 'https://nwioi-test.org/enroll', supervisors: '', sampleWeekend: '' }, paymentPlans: [{ label: '12 months', monthly: 625, months: 12, total: 7500, status: 'approved' }] });
  cat.payInFull.status = 'approved';
  const ok = est('sexuality_educator', {}, { preview: false }, cat).tracks.comprehensive;
  assert.deepEqual([ok.price.amount, ok.price.payInFull.display, ok.price.draft], [7250, '$6,742.50', false]);
  assert.equal(ok.cta.link.url, 'https://nwioi-test.org/enroll');
  assert.equal(ok.paymentPlans[0].text, '$625/month for 12 months ($7,500 total)');
});

test('next steps match the track; scholarship equity question goes to admissions', () => {
  const links = { booking: 'https://calendar.nwioi-test.org/admissions' };
  const r = est('sex_therapist', full(), { preview: true, links });
  assert.equal(r.tracks.comprehensive.cta.label, 'Explore enrollment');
  assert.equal(r.tracks.core.cta.label, 'Review my prior training');
  assert.equal(r.tracks.modular.cta.label, 'Explore courses');
  assert.equal(r.tracks.modular.secondary.label, 'Help me choose what I need');
  assert.equal(r.scholarship.equity.url, links.booking);
  assert.match(r.scholarship.copy, /^NWIOI offers a discounted rate for people with marginalized and intersecting identities/);
});

test('placeholder links are never shown publicly', () => {
  assert.equal(isPlaceholderUrl('https://example.com/nwioi-admissions-calendar'), true);
  assert.equal(usableLink('https://example.com/x', false), null);
  assert.deepEqual(usableLink('https://example.com/x', true), { url: 'https://example.com/x', placeholder: true });
  assert.deepEqual(usableLink('https://forms.wix.com/f/7167298250691576552', false), { url: 'https://forms.wix.com/f/7167298250691576552', placeholder: false });
});
