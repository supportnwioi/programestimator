import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_CATALOG, trackEstimate, validateCatalog, benchmarks, priorCoverage } from '../src/tracks.js';
import { isPlaceholderUrl, usableLink } from '../src/links.js';

const load = (f) => JSON.parse(fs.readFileSync(new URL(`../config/rulesets/${f}`, import.meta.url)));
const R = {
  sex_therapist: load('sex_therapist.2026.T.1.json'),
  sexuality_counselor: load('sexuality_counselor.2026.C.1.json'),
  sexuality_educator: load('sexuality_educator.2026.E.1.json'),
};
const PATHS = Object.keys(R);
const est = (path, input, opts = { preview: true }, catalog = DEFAULT_CATALOG) =>
  trackEstimate(catalog, R[path], { core: null, skills: null, supervision: null, sar: null, supervisionWhere: null, additional: {}, alaCarte: {}, ...input }, opts);
// A full set of answers (recommendation ready).
const full = (o = {}) => ({ core: 0, skills: 0, supervision: 0, sar: 'no', supervisionWhere: 'nwioi', ...o });

test('catalog matches each credential’s AASECT ruleset; Core is 99 CEUs and always includes SAR', () => {
  assert.deepEqual(validateCatalog(DEFAULT_CATALOG, R), []);
  assert.deepEqual(PATHS.map((p) => { const b = benchmarks(R[p]); return [b.core, b.skills, b.supervision, b.minMonths]; }), [[90, 60, 50, 18], [90, 60, 30, 12], [90, 60, 25, 9]]);
  for (const p of PATHS) {
    const c = DEFAULT_CATALOG.credentials[p].core;
    assert.equal(c.ceus, 99);
    assert.equal(c.includesSar, true);
  }
  assert.deepEqual(DEFAULT_CATALOG.tierNames, { core: 'Tier I · Core Program', alaCarte: 'Tier II · À La Carte' });
  assert.ok(!JSON.stringify(DEFAULT_CATALOG.credentials).includes('comprehensive'), '150-CEU Comprehensive package is gone');
});

test('validation catches packages that don’t fit the credential', () => {
  const bad = structuredClone(DEFAULT_CATALOG);
  bad.credentials.sexuality_educator.core.supervision.groupHours = 24;
  bad.credentials.sex_therapist.core.minMonths = 12;
  bad.credentials.sexuality_counselor.core.includesSar = false;
  bad.credentials.sexuality_counselor.core.curriculumMapping = { core: 60, skills: 30 };
  const errors = validateCatalog(bad, R).join('\n');
  assert.match(errors, /sexuality_educator: supervision package is 29 hours; target is 25/);
  assert.match(errors, /sex_therapist: minimum supervision period 12 months; AASECT requires 18/);
  assert.match(errors, /sexuality_counselor: Core must include SAR/);
  assert.match(errors, /sexuality_counselor: curriculum mapping 60 \+ 30 ≠ 99 CEUs/);
});

test('Core tuition and pay in full for all three credentials, with each supervision package', () => {
  const r = PATHS.map((p) => est(p, {}).tracks.core);
  assert.deepEqual(r.map((t) => t.price.amount), [8200, 7450, 6950]);
  assert.deepEqual(r.map((t) => t.price.display), ['$8,200', '$7,450', '$6,950']);
  assert.deepEqual(r.map((t) => [t.price.payInFull.display, t.price.payInFull.percent]), [['$7,626.00', 7], ['$6,928.50', 7], ['$6,463.50', 7]]);
  assert.deepEqual(r.map((t) => t.name), Array(3).fill('Tier I · Core Program'));
  const sup = r.map((t) => t.included.find((x) => x.startsWith('Supervision')));
  assert.match(sup[0], /26 individual hours and 24 group hours/);
  assert.match(sup[1], /15 individual hours and 15 group hours/);
  assert.match(sup[2], /Five individual hours .* and 20 group hours/);
  for (const t of r) {
    assert.ok(t.included.includes('99 CEUs of NWIOI coursework'));
    assert.ok(t.included.includes('SAR included'));
  }
  assert.match(est('sexuality_educator', {}).tracks.core.lead, /^Design and deliver a sexuality education program/);
});

test('Core always includes SAR: tuition is the same whatever the SAR, supervision or prior answers', () => {
  const amounts = [{}, full({ sar: 'yes' }), full({ sar: 'no' }), full({ sar: 'unsure' }), full({ core: 90, skills: 60, supervision: 50 })]
    .map((i) => est('sex_therapist', i).tracks.core.price.amount);
  assert.deepEqual([...new Set(amounts)], [8200]);
  assert.match(est('sex_therapist', full({ sar: 'yes' })).notes.join(' '), /SAR is included in Core either way, and Core tuition stays the same/);
});

test('25 prior CEUs → 26 remaining → $910 additional → combined $9,110 / $8,360 / $7,860', () => {
  const r = PATHS.map((p) => est(p, { core: 15, skills: 10 }).prior);
  for (const pr of r) {
    assert.deepEqual([pr.state, pr.rough, pr.nwioiCeus, pr.gapBeforePrior, pr.counted, pr.remaining], ['known', true, 99, 51, 25, 26]);
    assert.equal(pr.additional.display, '$910');
    assert.equal(pr.combined.complete, true);
  }
  assert.deepEqual(r.map((pr) => pr.combined.display), ['$9,110', '$8,360', '$7,860']);
  assert.deepEqual(r.map((pr) => pr.priorSavings.display), ['$875', '$875', '$875'], '25 counted hours × planning rate');
  assert.equal(est('sex_therapist', { core: 0, skills: 0 }).prior.priorSavings, null, 'no savings line when nothing counts');
  assert.equal(est('sex_therapist', { core: 15, skills: 10 }, { preview: false }).prior.priorSavings.display, '$875', 'planning rate approved: shows publicly');
});

test('outside coursework: CEUs taken elsewhere leave NWIOI tuition unchanged and add the cost the visitor enters', () => {
  const noCost = est('sex_therapist', { core: 15, skills: 10, additional: { nwioiCeus: 10 } }).prior;
  assert.deepEqual([noCost.nwioiAdditionalCeus, noCost.outsideCeus, noCost.additional.display, noCost.outsideCost], [10, 16, '$350', null]);
  assert.deepEqual([noCost.combined.display, noCost.combined.complete], ['$8,550', false]);
  const withCost = est('sex_therapist', { core: 15, skills: 10, additional: { nwioiCeus: 0, outsideCost: 1200 } }).prior;
  assert.deepEqual([withCost.additional.amount, withCost.outsideCost, withCost.combined.display, withCost.combined.complete], [0, 1200, '$9,400', true]);
  assert.equal(est('sex_therapist', { core: 15, skills: 10, additional: { nwioiCeus: 0, outsideCost: 1200 } }).tracks.core.price.amount, 8200);
});

test('overlapping coursework counts once (rough gap and with a curriculum mapping)', () => {
  const big = est('sex_therapist', { core: 90, skills: 60 }).prior;
  assert.deepEqual([big.reported, big.counted, big.overlap, big.remaining], [150, 51, 99, 0]);
  assert.equal(big.combined.display, '$8,200');
  // Hypothetical mapping: Core covers 60 core + 39 skills hours.
  const b = benchmarks(R.sex_therapist);
  const core = { ceus: 99, curriculumMapping: { core: 60, skills: 39 } };
  const h = (n) => ({ state: 'hours', hours: n });
  const m = priorCoverage(b, core, h(40), h(5));
  // Core gap 30 is filled by 30 of the 40 core hours (10 overlap); skills gap 21 minus 5 → 16 still needed.
  assert.deepEqual([m.rough, m.counted, m.overlap, m.remaining, m.remainingCore, m.remainingSkills], [false, 35, 10, 16, 0, 16]);
  // Extra core hours never fill a skills gap.
  assert.equal(priorCoverage(b, core, h(90), h(0)).remainingSkills, 21);
});

test('unknown answers stay unresolved; no additional or combined cost is guessed', () => {
  const u = est('sex_therapist', { core: 20, skills: 'unsure' }).prior;
  assert.deepEqual([u.state, u.knownCore, u.knownSkills, u.unsure], ['unresolved', 20, null, true]);
  assert.equal(u.additional, undefined);
  assert.equal(u.combined, undefined);
  assert.equal(est('sex_therapist', {}).prior.state, 'unresolved');
});

test('“Recommended for you” only once the answers support it', () => {
  const none = est('sex_therapist', {});
  assert.deepEqual([none.recommended, none.startingPoint, none.reasons.length], [null, 'core', 0]);
  assert.equal(est('sex_therapist', { core: 10, skills: 0, supervision: 0, sar: 'no' }).recommended, null);
  assert.equal(est('sex_therapist', full()).recommended, 'core');
  assert.equal(est('sex_therapist', full({ supervision: 20 })).recommended, 'alaCarte');
  assert.equal(est('sex_therapist', { supervisionWhere: 'outside' }).recommended, 'alaCarte');
});

test('À La Carte: one total; quantities only; no unit prices or line amounts in the payload', () => {
  // SAR answered "No" but not ticked: not in the total.
  const untick = est('sex_therapist', full({ core: 15, skills: 10 })).tracks.alaCarte;
  assert.deepEqual([untick.price.display, untick.items.some((x) => x.startsWith('SAR')), untick.sarOffer], ['$11,045', false, 'Add SAR']);
  // Reported scenario: 10 + 11 CEUs still needed, supervision done, SAR "No" → courses only.
  const reported = est('sex_therapist', full({ core: 80, skills: 49, supervision: 50 })).tracks.alaCarte;
  assert.deepEqual([reported.price.display, reported.items], ['$735', ['10 Core Knowledge CEUs', '11 Sex Therapy Skills Training CEUs']]);
  const r = est('sex_therapist', full({ core: 15, skills: 10, alaCarte: { sar: true } }));
  const a = r.tracks.alaCarte;
  assert.equal(a.name, 'Tier II · À La Carte');
  assert.deepEqual([a.price.display, a.price.complete], ['$11,695', true]);
  assert.deepEqual(a.items, ['75 Core Knowledge CEUs', '50 Sex Therapy Skills Training CEUs', 'SAR (Sexuality Attitude Reassessment)', '26 hours of individual supervision', '8 group supervision sessions, 3 hours each']);
  const json = JSON.stringify(a);
  for (const leak of ['$35', '$195', '$200', '$650', '2,625', '5,070', '1,600', '"amount":35']) assert.ok(!json.includes(leak), `À La Carte payload leaks ${leak}`);
  assert.ok(!('lines' in a) && !('subtotal' in a));
});

test('À La Carte includes SAR and NWIOI supervision only when selected; outside supervision is paid separately', () => {
  const yes = est('sex_therapist', full({ core: 90, skills: 60, sar: 'yes', supervision: 50 })).tracks.alaCarte;
  assert.deepEqual([yes.items, yes.price.amount, yes.sarOffer], [[], 0, null]);
  const unsure = est('sex_therapist', full({ core: 90, skills: 60, supervision: 50, sar: 'unsure' })).tracks.alaCarte;
  assert.equal(unsure.sarOffer, 'Add SAR if needed');
  assert.ok(!unsure.items.some((x) => x.startsWith('SAR')));
  const added = est('sex_therapist', full({ core: 90, skills: 60, supervision: 50, sar: 'unsure', alaCarte: { sar: true } })).tracks.alaCarte;
  assert.deepEqual(added.items, ['SAR (Sexuality Attitude Reassessment)']);
  const out = est('sex_therapist', full({ core: 90, skills: 60, supervisionWhere: 'outside' })).tracks.alaCarte;
  assert.ok(out.notes.includes('You’ll pay your outside supervisor separately.'));
  assert.ok(!out.items.some((x) => /supervision/.test(x)));
});

test('À La Carte coursework: category gaps after prior coursework, at the CEU rate; unknowns unresolved', () => {
  const k = est('sex_therapist', { core: 60, skills: 29 }).tracks.alaCarte.coursework;
  assert.deepEqual([k.state, k.remaining, k.remainingCore, k.remainingSkills, k.cost.display], ['known', 61, 30, 31, '$2,135']);
  const over = est('sex_therapist', { core: 90, skills: 0 }).tracks.alaCarte.coursework;
  assert.deepEqual([over.remainingCore, over.remainingSkills, over.remaining], [0, 60, 60], 'extra core never fills skills');
  const u = est('sex_therapist', { core: 60, skills: 'unsure' }).tracks.alaCarte.coursework;
  assert.deepEqual([u.state, u.remainingCore, u.remainingSkills, u.unsure, u.cost], ['unresolved', 30, null, true, undefined]);
  assert.equal(est('sex_therapist', { core: 60, skills: 29 }, { preview: false }).tracks.alaCarte.coursework.cost, null, 'no cost while the rate is draft');
  for (const p of PATHS) assert.equal(est(p, { core: 60, skills: 29 }).tracks.core.price.amount, est(p, {}).tracks.core.price.amount);
  const fewer = est('sex_therapist', { core: 60, skills: 29, alaCarte: { skillsCeus: 10 } }).tracks.alaCarte;
  assert.equal(fewer.fewerThanNeeded, true);
  assert.equal(est('sex_therapist', { core: 60, skills: 29 }).tracks.alaCarte.fewerThanNeeded, false);
  // Supervision is optional: not counted until NWIOI supervision is chosen.
  const noWhere = est('sex_therapist', { core: 60, skills: 29, supervision: 0 }).tracks.alaCarte;
  assert.deepEqual([noWhere.price.display, noWhere.price.complete], ['$2,135', true]);
});

test('a rough total never assigns categories or estimates what can be skipped; categories override it', () => {
  const t = est('sex_therapist', { total: 25 }).prior;
  assert.deepEqual([t.state, t.basis, t.covered, t.days, t.remaining, t.additional, t.combined], ['rough', 'total', 25, 3, null, undefined, undefined]);
  assert.equal(est('sex_therapist', { total: 25 }).tracks.alaCarte.coursework.state, 'unresolved');
  assert.equal(est('sex_therapist', { total: 500 }).prior.covered, 150, 'capped at the coursework requirement');
  assert.equal(est('sex_therapist', { total: 5 }).prior.days, 0);
  assert.deepEqual([est('sex_therapist', { total: 'unsure' }).prior.state, est('sex_therapist', { total: 'unsure' }).prior.unsure], ['unresolved', true]);
  const both = est('sex_therapist', { total: 40, core: 30, skills: 5 }).prior;
  assert.deepEqual([both.basis, both.covered, both.unassigned, both.remaining], ['categories', 35, 5, 16], 'unknown-category hours stay unassigned');
  for (const total of [0, 25, 150]) assert.equal(est('sex_therapist', { total }).tracks.core.price.amount, 8200, 'Core tuition fixed');
});

test('where prior learning came from: semester credits × 15; AASECT CE hour for hour; other CE half; unsure CE pending', () => {
  const credits = est('sexuality_counselor', { college: { answer: 'yes', unit: 'credits', amount: 3 } }).prior;
  assert.deepEqual([credits.sources.college.hours, credits.covered, credits.state], [45, 45, 'rough']);
  const ceOnly = est('sexuality_counselor', { college: { answer: 'no' }, ce: { answer: 'yes', aasect: 10, other: 12, unsure: 5 } }).prior;
  assert.deepEqual([ceOnly.sources.ce.hours, ceOnly.sources.ce.otherHours, ceOnly.sources.ce.pending, ceOnly.covered], [16, 6, 5, 16], 'CE works with no college coursework');
  const classHours = est('sexuality_educator', { college: { answer: 'yes', unit: 'hours', amount: 30 }, ce: { answer: 'no' } }).prior;
  assert.equal(classHours.covered, 30);
  assert.equal(est('sex_therapist', { college: { answer: 'unsure' } }).prior.sources.state, 'unsure');
  assert.equal(est('sex_therapist', { college: { answer: 'no' }, ce: { answer: 'no' } }).prior.sources.state, 'zero');
  assert.equal(est('sex_therapist', { college: { answer: 'yes' } }).prior.sources.state, 'incomplete');
  assert.equal(est('sex_therapist', { college: { answer: 'no' }, ce: { answer: 'yes', unsure: 8 } }).prior.sources.state, 'unsure', 'only unsure credits → review');
  const pay = est('sex_therapist', { college: { answer: 'yes', unit: 'hours', amount: 20 }, ce: { answer: 'yes', aasect: 5 } }).prior.potentialSavings;
  assert.deepEqual([pay.hours, pay.display, pay.rate], [25, '$875', '$35'], '20 class hours + 5 AASECT CE');
  assert.equal(est('sex_therapist', { college: { answer: 'yes', unit: 'hours', amount: 20 }, ce: { answer: 'yes', aasect: 5 } }, { preview: false }).prior.potentialSavings.display, '$875', 'approved rate shows publicly');
  assert.equal(est('sex_therapist', { college: { answer: 'no' }, ce: { answer: 'no' } }).prior.potentialSavings, null);
  assert.equal(est('sex_therapist', { core: 60, skills: 29 }).prior.potentialSavings.display, '$3,115', 'category hours use the same count shown');
  const live = est('sex_therapist', { core: 30, skills: 5, liveCore: 10, liveSkills: 40 }).prior.live;
  assert.deepEqual([live.core.hours, live.core.min, live.skills.hours, live.skills.min], [10, 15, 40, 30]);
});

test('package savings only when both totals cover the same components and quantities', () => {
  const s = PATHS.map((p) => est(p, {}).savings);
  assert.deepEqual([s[0].display, s[0].separately], ['$2,585', '$10,785']);
  assert.deepEqual(s[0].items, ['99 CEUs', '26 hours of individual supervision', '8 group supervision sessions, 3 hours each (24 group hours)', 'SAR']);
  assert.equal(s[1].display, '$590');
  assert.equal(s[2], null, 'Educator’s 20 group hours don’t divide into 3-hour sessions, so no savings figure');
});

test('drafts are hidden publicly; approved offers and the scholarship link show', () => {
  const pub = est('sex_therapist', full({ core: 15, skills: 10 }), { preview: false });
  assert.equal(pub.tracks.core.price.confirmText, 'Confirm Core tuition with admissions');
  assert.equal(pub.tracks.alaCarte.price.amount, null);
  assert.equal(pub.prior.combined, null);
  assert.equal(pub.savings, null);
  const json = JSON.stringify(pub);
  for (const leak of ['8,200', '7,626', '$195', '$650']) assert.ok(!json.includes(leak), `public payload leaks ${leak}`);
  assert.equal(pub.scholarship.application.url, 'https://forms.wix.com/f/7167298250691576552');
  const cat = structuredClone(DEFAULT_CATALOG);
  Object.assign(cat.credentials.sexuality_educator.core, { status: 'approved', paymentPlans: [{ label: '12 months', monthly: 600, months: 12, total: 7200, status: 'approved' }] });
  cat.payInFull.status = 'approved';
  const ok = est('sexuality_educator', {}, { preview: false }, cat).tracks.core;
  assert.deepEqual([ok.price.amount, ok.price.payInFull.display, ok.price.draft], [6950, '$6,463.50', false]);
  assert.equal(ok.paymentPlans[0].text, '$600/month for 12 months ($7,200 total)');
});

test('next steps: Review my prior training, the course library, and admissions for equity questions', () => {
  const links = { booking: 'https://calendar.nwioi-test.org/admissions' };
  const cat = structuredClone(DEFAULT_CATALOG);
  cat.library.url = 'https://nwioi-test.org/library';
  const r = est('sex_therapist', full(), { preview: true, links }, cat);
  assert.deepEqual([r.tracks.core.cta.label, r.tracks.core.cta.link.url], ['Review my prior training', links.booking]);
  assert.deepEqual([r.tracks.core.secondary.label, r.tracks.core.secondary.link.url], ['Explore the NWIOI course library', 'https://nwioi-test.org/library']);
  assert.equal(r.prior.libraryNote, 'Additional NWIOI courses depend on current availability.');
  assert.equal(r.tracks.alaCarte.secondary.label, 'Book a free admissions call');
  assert.equal(r.scholarship.equity.url, links.booking);
});

test('placeholder links are never shown publicly', () => {
  assert.equal(isPlaceholderUrl('https://example.com/nwioi-admissions-calendar'), true);
  assert.equal(usableLink('https://example.com/x', false), null);
  assert.deepEqual(usableLink('https://example.com/x', true), { url: 'https://example.com/x', placeholder: true });
  assert.deepEqual(usableLink('https://forms.wix.com/f/7167298250691576552', false), { url: 'https://forms.wix.com/f/7167298250691576552', placeholder: false });
});
