// Quick estimator: an aggregate, slider-based ballpark. It does not use the
// detailed engine (which needs itemized entries and per-area hours). It uses
// the active ruleset only for benchmarks, and server-side pricing for dollars.
// The public result contains a range and short notes, never rates.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './store.js';

export const ASSUMPTIONS = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/quick-estimate.json'), 'utf8'));

const PLACEHOLDER_HOST = /(^|\.)(example\.(com|org|net)|localhost)$/i;

// A link is usable only when it is a real destination, not the shipped placeholder.
export function isPlaceholderUrl(u) {
  if (!u || typeof u !== 'string') return true;
  try {
    const url = new URL(u.trim());
    if (url.protocol === 'mailto:') {
      const domain = decodeURIComponent(url.pathname).split('@')[1]?.toLowerCase() || '';
      return !domain || PLACEHOLDER_HOST.test(domain);
    }
    if (!/^https?:$/.test(url.protocol)) return true;
    return PLACEHOLDER_HOST.test(url.hostname);
  } catch {
    return true;
  }
}

export function benchmarks(ruleset) {
  const req = (k) => ruleset.requirements.find((r) => r.key === k);
  const core = req('core'), training = req('training'), sup = req('supervision'), sar = req('sar');
  return {
    education: core.totalHours + training.totalHours,
    educationParts: { core: core.totalHours, training: training.totalHours },
    educationLabels: { core: core.label, training: training.label },
    supervision: sup.totalHours,
    supervisionMinMonths: sup.minMonths,
    sarHours: sar.hours,
    semesterCreditClockHours: ruleset.creditRules.academicSemesterCreditClockHours,
    nonAasectCeMultiplier: ruleset.creditRules.nonAasectCeMultiplier,
  };
}

// unanswered (null) / unsure / a number of hours are three distinct states.
export function parseAnswer(v, max) {
  if (v === 'unsure') return { state: 'unsure' };
  if (v === null || v === undefined || v === '') return { state: 'unanswered' };
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return { state: 'unanswered' };
  return { state: 'hours', hours: Math.min(n, max), atMax: n >= max };
}

// Hours still needed, as a range: lo = fewest (optimistic), hi = most (cautious).
function remaining(target, ans, credit) {
  if (ans.state === 'unsure') {
    const assumed = target * ASSUMPTIONS.unsureAssumedShareOfBenchmark;
    return { lo: target - assumed * credit.high, hi: target };
  }
  return { lo: target - ans.hours * credit.high, hi: target - ans.hours * credit.low };
}

const roundDown = (n, step) => Math.floor(n / step) * step;
const roundUp = (n, step) => Math.ceil(n / step) * step;
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

/**
 * @param ruleset active approved ruleset for the path
 * @param settings server-side pricing settings
 * @param input { education, supervision, sar } — education/supervision: number | 'unsure' | null; sar: 'yes'|'no'|'unsure'|null
 * @param options { preview } — true for a signed-in admin; shows sample pricing that is not yet confirmed
 */
export function quickEstimate(ruleset, settings, input, { preview = false } = {}) {
  const b = benchmarks(ruleset);
  const edu = parseAnswer(input.education, b.education);
  const sup = parseAnswer(input.supervision, b.supervision);
  const sar = ['yes', 'no', 'unsure'].includes(input.sar) ? input.sar : null;
  const offers = settings.offerings?.[ruleset.path] ?? {};

  const priorTraining = [edu, sup].some((a) => a.state === 'unsure' || (a.state === 'hours' && a.hours > 0)) || sar === 'yes' || sar === 'unsure';
  const startingFromScratch = edu.state === 'hours' && edu.hours === 0 && sup.state === 'hours' && sup.hours === 0 && sar !== 'yes';
  const base = { path: ruleset.path, rulesetVersion: ruleset.version, priorTraining, startingFromScratch, preview: false, notes: [] };

  if (edu.state === 'unanswered' || sup.state === 'unanswered') return { ...base, status: 'incomplete' };

  const confirmed = settings.pricingConfirmed === true;
  if (!confirmed && !preview) return { ...base, status: 'personalized', reason: 'pricing_unconfirmed' };

  if (edu.atMax && sup.atMax) return { ...base, status: 'personalized', reason: 'at_maximum', preview: !confirmed };

  // Education: only the parts NWIOI offers for this path are priced.
  const offeredShare = ((offers.core !== false ? b.educationParts.core : 0) + (offers.training !== false ? b.educationParts.training : 0)) / b.education;
  const e = remaining(b.education, edu, ASSUMPTIONS.educationCredit);
  const s = offers.supervision !== false ? remaining(b.supervision, sup, ASSUMPTIONS.supervisionCredit) : { lo: 0, hi: 0 };
  const sarOffered = offers.sar !== false;
  const sarLo = sarOffered && sar === 'no' ? settings.sarPrice : 0;
  const sarHi = sarOffered && sar !== 'yes' ? settings.sarPrice : 0;

  const costLo = e.lo * offeredShare * settings.educationRatePerCeHour + s.lo * settings.supervisionRatePerHour + sarLo;
  const costHi = e.hi * offeredShare * settings.educationRatePerCeHour + s.hi * settings.supervisionRatePerHour + sarHi;
  if (!(costHi > 0)) return { ...base, status: 'personalized', reason: 'nothing_offered', preview: !confirmed };

  const buffer = Number(settings.priceRangeBuffer) || 0;
  const step = ASSUMPTIONS.roundTo;
  const low = roundDown(Math.max(costLo - buffer, costLo * ASSUMPTIONS.lowerBoundMinimumShare), step);
  const high = roundUp(costHi + buffer, step);

  const notes = [];
  if (edu.state === 'unsure' || sup.state === 'unsure') notes.push('Because you’re not sure about some of your hours, this range is wider.');
  if (sar === 'yes') notes.push('You said you’ve completed a SAR. NWIOI will confirm whether it meets the requirement.');
  if (sar === 'unsure' || sar === null) notes.push('The range allows for a SAR in case you still need one.');
  if (offeredShare < 1 || offers.supervision === false || !sarOffered) notes.push('Some requirements may need to be completed outside NWIOI and aren’t included here.');

  return {
    ...base, status: 'priced', preview: !confirmed,
    range: { low, high, display: `${money(low)}–${money(high)}` },
    notes,
  };
}
