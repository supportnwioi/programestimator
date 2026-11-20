import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { quickEstimate, isPlaceholderUrl, benchmarks } from '../src/quickEstimate.js';

const load = (f) => JSON.parse(fs.readFileSync(new URL(`../config/rulesets/${f}`, import.meta.url)));
const ST = load('sex_therapist.2026.T.1.json');
const SC = load('sexuality_counselor.2026.C.1.json');
const SE = load('sexuality_educator.2026.E.1.json');
const CONFIRMED = { educationRatePerCeHour: 35, supervisionRatePerHour: 185, sarPrice: 650, priceRangeBuffer: 500, pricingConfirmed: true, offerings: {} };
const q = (r, input, settings = CONFIRMED, opts) => quickEstimate(r, settings, { education: null, supervision: null, sar: null, ...input }, opts);

test('benchmarks come from the active ruleset for each path', () => {
  assert.deepEqual([ST, SC, SE].map((r) => [benchmarks(r).education, benchmarks(r).supervision]), [[150, 50], [150, 30], [150, 25]]);
  assert.equal(benchmarks(ST).semesterCreditClockHours, 15);
});

test('unanswered, zero and unsure are distinct', () => {
  const un = q(ST, { supervision: 0 });
  const zero = q(ST, { education: 0, supervision: 0, sar: 'no' });
  const unsure = q(ST, { education: 'unsure', supervision: 0, sar: 'no' });
  assert.equal(un.status, 'incomplete');
  assert.equal(zero.status, 'priced');
  assert.equal(unsure.status, 'priced');
  assert.ok(unsure.range.low < zero.range.low, 'unsure allows for some prior hours at the low end');
  assert.equal(unsure.range.high, zero.range.high, 'unsure never assumes hours count at the high end');
  assert.ok(unsure.notes.some((n) => /not sure/.test(n)));
  assert.equal(zero.startingFromScratch, true);
  assert.equal(unsure.priorTraining, true);
});

test('more potentially applicable hours lower the estimate or leave it unchanged', () => {
  for (const r of [ST, SC, SE]) {
    const b = benchmarks(r);
    let prev = null;
    for (let e = 0; e <= b.education; e += 5) {
      const res = q(r, { education: e, supervision: 10, sar: 'no' });
      if (res.status !== 'priced') continue;
      if (prev) {
        assert.ok(res.range.low <= prev.low && res.range.high <= prev.high, `${r.path} education ${e}: ${res.range.display} vs ${prev.display}`);
      }
      prev = res.range;
    }
    prev = null;
    for (let s = 0; s <= b.supervision; s += 1) {
      const res = q(r, { education: 40, supervision: s, sar: 'no' });
      if (prev) assert.ok(res.range.low <= prev.low && res.range.high <= prev.high, `${r.path} supervision ${s}`);
      prev = res.range;
    }
  }
});

test('moving a slider changes the range', () => {
  const a = q(ST, { education: 20, supervision: 10, sar: 'no' });
  const b = q(ST, { education: 80, supervision: 10, sar: 'no' });
  const c = q(ST, { education: 80, supervision: 30, sar: 'no' });
  assert.notEqual(a.range.display, b.range.display);
  assert.notEqual(b.range.display, c.range.display);
});

test('reaching both maximums asks for a personalized estimate, never $0', () => {
  const max = q(SE, { education: 150, supervision: 25, sar: 'yes' });
  assert.equal(max.status, 'personalized');
  assert.equal(max.reason, 'at_maximum');
  assert.equal(max.range, undefined);
  // One slider at max still shows a price that is not $0.
  const one = q(SE, { education: 150, supervision: 24, sar: 'yes' });
  assert.equal(one.status, 'priced');
  assert.ok(one.range.low > 0);
  // Over-the-benchmark typed values are clamped, still personalized.
  assert.equal(q(SE, { education: 9999, supervision: 9999 }).status, 'personalized');
});

test('the lower bound never reaches $0 for any slider combination', () => {
  for (const r of [ST, SC, SE]) {
    const b = benchmarks(r);
    for (let e = 0; e <= b.education; e += 10) for (let s = 0; s <= b.supervision; s += 5) for (const sar of ['yes', 'no', 'unsure', null]) {
      const res = q(r, { education: e, supervision: s, sar });
      if (res.status === 'priced') assert.ok(res.range.low > 0, `${r.path} ${e}/${s}/${sar}`);
    }
  }
});

test('SAR: yes is self-reported and excluded; no is included; unsure or unanswered widens the range', () => {
  const yes = q(ST, { education: 50, supervision: 20, sar: 'yes' });
  const no = q(ST, { education: 50, supervision: 20, sar: 'no' });
  const unsure = q(ST, { education: 50, supervision: 20, sar: 'unsure' });
  const none = q(ST, { education: 50, supervision: 20 });
  assert.ok(yes.range.high < no.range.high && yes.range.low < no.range.low);
  assert.equal(unsure.range.low, yes.range.low);
  assert.equal(unsure.range.high, no.range.high);
  assert.deepEqual(none.range, unsure.range);
  assert.ok(yes.notes.some((n) => /NWIOI will confirm/.test(n)));
});

test('unconfirmed pricing is never shown publicly; admins get a labeled preview', () => {
  const sample = { ...CONFIRMED, pricingConfirmed: false };
  const pub = q(ST, { education: 10, supervision: 0, sar: 'no' }, sample);
  assert.equal(pub.status, 'personalized');
  assert.equal(pub.reason, 'pricing_unconfirmed');
  assert.equal(pub.range, undefined);
  const admin = q(ST, { education: 10, supervision: 0, sar: 'no' }, sample, { preview: true });
  assert.equal(admin.status, 'priced');
  assert.equal(admin.preview, true);
  assert.equal(q(ST, { education: 10, supervision: 0, sar: 'no' }).preview, false);
});

test('requirements NWIOI does not offer are left out of the price', () => {
  const all = q(SE, { education: 0, supervision: 0, sar: 'no' });
  const noSup = q(SE, { education: 0, supervision: 0, sar: 'no' }, { ...CONFIRMED, offerings: { sexuality_educator: { supervision: false } } });
  assert.ok(noSup.range.high < all.range.high);
  assert.ok(noSup.notes.some((n) => /outside NWIOI/.test(n)));
});

test('public result contains no internal pricing inputs', () => {
  const res = q(ST, { education: 30, supervision: 5, sar: 'no' });
  const json = JSON.stringify(res);
  for (const leak of ['185', 'Rate', 'rate', 'sarPrice', 'buffer', 'costLo', 'costHi', '"0.9"', 'credit']) assert.ok(!json.includes(leak), `leaks ${leak}`);
});

test('placeholder links are detected', () => {
  assert.equal(isPlaceholderUrl('https://example.com/nwioi-admissions-calendar'), true);
  assert.equal(isPlaceholderUrl('mailto:admissions@example.org?subject=x'), true);
  assert.equal(isPlaceholderUrl(''), true);
  assert.equal(isPlaceholderUrl('javascript:alert(1)'), true);
  assert.equal(isPlaceholderUrl('https://calendly.com/nwioi/admissions'), false);
  assert.equal(isPlaceholderUrl('mailto:admissions@nwioi.com'), false);
});
