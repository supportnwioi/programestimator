// Turns an engine result into (a) a private, itemized NWIOI price calculation and
// (b) the public estimate: one price range plus a checklist. Public output never
// contains rates or itemized prices.
import { evaluate } from './engine.js';

const fmtH = (n) => {
  const r = Math.round(n * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)} hour${r === 1 ? '' : 's'}`;
};
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

export function priceCalculation(ruleset, calc, settings) {
  const offers = settings.offerings?.[ruleset.path] ?? {};
  const lines = [];
  const outside = [];
  for (const req of ruleset.requirements) {
    const r = calc.requirements[req.key];
    const offered = offers[req.key] !== false;
    if (req.kind === 'hours' && r.remaining > 0) {
      (offered ? lines : outside).push({ key: req.key, kind: 'education', hours: r.remaining, rate: settings.educationRatePerCeHour });
    } else if (req.kind === 'supervision' && r.remaining > 0) {
      (offered ? lines : outside).push({ key: req.key, kind: 'supervision', hours: r.remaining, rate: settings.supervisionRatePerHour });
    } else if (req.kind === 'sar' && r.status === 'outstanding') {
      (offered ? lines : outside).push({ key: 'sar', kind: 'sar', quantity: 1, price: settings.sarPrice });
    }
  }
  for (const l of lines) l.amount = Math.round((l.kind === 'sar' ? l.price : l.hours * l.rate) * 100) / 100;
  const amount = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const buffer = Number(settings.priceRangeBuffer) || 0;
  return { lines, outsideNwioi: outside.map((o) => o.key), amount, range: { low: Math.max(0, amount - buffer), high: amount + buffer } };
}

function hoursItem(req, r, offered) {
  const item = { key: req.key, label: req.label, offeredByNwioi: offered, details: [] };
  if (r.remaining <= 0) { item.status = 'complete'; item.text = `${req.label} — appears complete`; return item; }
  item.status = 'remaining';
  item.hours = r.remaining;
  const short = r.areas.filter((a) => a.neededInArea > 0);
  const parts = [];
  if (short.length) {
    const n = r.areaShortfallTotal;
    const term = req.checklistTerm || req.areaTermShort;
    const where = short.length === 1 ? `a ${term}` : `${short.length} ${term}s`;
    parts.push(r.remaining > n || r.overallGap > 0
      ? `including ${fmtH(n)} in ${where} where the minimum has not yet been met`
      : `all in ${where} where the minimum has not yet been met`);
    for (const a of short) {
      const cond = r.conditional.find((c) => c.area === a.key && c.shortfall > 0);
      item.details.push({
        text: `${req.areaTerm} ${a.key} · ${a.label} — ${fmtH(a.neededInArea)}${cond ? ` (includes ${fmtH(cond.shortfall)} of ${cond.label})` : ''}`,
        included: true, area: a.key,
      });
    }
  }
  for (const c of r.conditional.filter((c) => c.shortfall > 0)) parts.push(`including ${fmtH(c.shortfall)} of ${c.label}`);
  if (r.syncShortfall > 0) item.details.push({ text: `At least ${fmtH(r.syncShortfall)} of these must be synchronous (in person or live virtual)`, included: true });
  if (r.specificShortfall > 0 && req.specificLabel) item.details.push({ text: `At least ${fmtH(r.specificShortfall)} must be specific to ${req.specificLabel}`, included: true });
  item.text = `${req.label} — ${fmtH(r.remaining)}${parts.length ? ', ' + parts.join(', ') : ''}`;
  return item;
}

function supervisionItem(req, r, offered, ruleset) {
  const item = { key: req.key, label: req.label, offeredByNwioi: offered, details: [] };
  if (r.remaining <= 0) { item.status = 'complete'; item.text = 'Supervision — appears complete'; }
  else {
    item.status = 'remaining';
    item.hours = r.remaining;
    item.text = `Supervision — ${fmtH(r.remaining)}`;
    if (r.individualShortfall > 0) item.details.push({ text: `Including ${fmtH(r.individualShortfall)} of individual (one-to-one) supervision`, included: true });
  }
  const span = [`with an ${ruleset.terms.supervisorTitle}`, `over at least ${r.minMonths} months`];
  if (r.maxHoursPerMonth) span.push(`no more than ${r.maxHoursPerMonth} hours per month`);
  item.details.push({ text: `AASECT requires supervision ${span.join(', ')}.`, note: true });
  return item;
}

const SAR_TEXT = { met: 'SAR — Appears complete', outstanding: 'SAR — Appears outstanding', review: 'SAR — Needs admissions review' };

export function buildPublicEstimate(ruleset, calc, price) {
  const offers = (key) => !price.outsideNwioi.includes(key);
  const checklist = [];
  for (const req of ruleset.requirements) {
    const r = calc.requirements[req.key];
    if (req.kind === 'hours') checklist.push(hoursItem(req, r, offers(req.key)));
    else if (req.kind === 'supervision') checklist.push(supervisionItem(req, r, offers(req.key), ruleset));
    else if (req.kind === 'sar') checklist.push({ key: 'sar', label: 'SAR', status: r.status, text: SAR_TEXT[r.status], offeredByNwioi: offers('sar'), details: [] });
  }
  const outsideNwioi = [
    ...checklist.filter((c) => !c.offeredByNwioi && (c.status === 'remaining' || c.status === 'outstanding')).map((c) => ({ label: c.text, status: 'remaining' })),
    ...calc.outside,
  ];
  const all = [...Object.values(calc.requirements).flatMap((r) => r.flags), ...calc.duplicateFlags];
  const review = all.filter((f) => !f.informational).map((f) => f.message);
  const notes = all.filter((f) => f.informational).map((f) => f.message);
  return {
    path: ruleset.path, pathName: ruleset.pathName, credential: ruleset.credential,
    rulesetVersion: ruleset.version, sources: ruleset.sources.map((s) => ({ title: s.title, url: s.url })),
    range: { low: price.range.low, high: price.range.high, display: `${money(price.range.low)}–${money(price.range.high)}` },
    checklist, outsideNwioi, reviewItems: [...new Set(review)], countingNotes: [...new Set(notes)],
  };
}

export function runEstimate(ruleset, intake, settings) {
  const calc = evaluate(ruleset, intake);
  const price = priceCalculation(ruleset, calc, settings);
  const pub = buildPublicEstimate(ruleset, calc, price);
  return { calc, price, public: pub };
}
