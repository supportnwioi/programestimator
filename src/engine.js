// Requirements engine. Applies a structured AASECT ruleset (config/rulesets/*.json)
// to a student's intake and returns what appears to remain. No pricing here.
import { findDuplicates } from '../public/shared/dedupe.js';

const round = (n) => Math.round(n * 100) / 100;
const pos = (n) => Math.max(0, round(n));

export function creditMultiplier(ruleset, creditType) {
  const c = ruleset.creditRules;
  switch (creditType) {
    case 'academic': return { value: c.academicMultiplier, flag: null };
    case 'aasect_ce': return { value: c.aasectCeMultiplier, flag: null };
    case 'non_aasect_ce': return { value: c.nonAasectCeMultiplier, flag: null };
    case 'unsure': return { value: c.nonAasectCeMultiplier, flag: 'Credit type not confirmed — counted at the non-AASECT CE (half) value until admissions confirms.' };
    default: return { value: 0, flag: 'Training without academic credit or CE credit — not counted; admissions will review whether it can be accepted.' };
  }
}

export function courseClockHours(ruleset, entry) {
  const amt = Number(entry.totalAmount);
  if (!amt || amt <= 0) return null;
  switch (entry.totalUnit) {
    case 'semester_credits': return amt * ruleset.creditRules.academicSemesterCreditClockHours;
    case 'clock_hours':
    case 'ce_hours': return amt;
    default: return null; // quarter credits / unsure: no published conversion
  }
}

function emptyArea(a) {
  return { key: a.key, label: a.label, timeSensitive: a.timeSensitive, reported: 0, counted: 0, excessOverCap: 0, shortfall: 0 };
}

// Collect counted "pieces" of hours from course entries for one hours requirement.
function collectPieces(ruleset, req, entries, flags) {
  const pieces = [];
  for (const e of entries) {
    if (e.kind !== 'course') continue;
    const mult = creditMultiplier(ruleset, e.creditType);
    const allocs = (e.allocations || []).filter((a) => a.requirement === req.key);
    if (!allocs.length) continue;
    if (mult.flag) flags.push({ entryId: e.id, requirement: req.key, type: 'credit_type', message: `${e.title || 'Untitled entry'}: ${mult.flag}` });
    const total = courseClockHours(ruleset, e);
    if (e.totalUnit === 'quarter_credits') flags.push({ entryId: e.id, type: 'conversion', message: `${e.title}: quarter-credit conversion is not published by AASECT — admissions will confirm clock hours. Topic hours you entered are still used.` });
    // Hours across ALL requirements for this entry must not exceed the course total.
    const allKnown = (e.allocations || []).filter((a) => a.basis !== 'unsure' && Number(a.hours) > 0 && a.requirement !== 'none');
    const sumAll = allKnown.reduce((s, a) => s + Number(a.hours), 0);
    const scale = total && sumAll > total ? total / sumAll : 1;
    if (scale < 1) flags.push({ entryId: e.id, type: 'over_total', message: `${e.title}: topic hours (${round(sumAll)}) exceed the course total (${round(total)}); scaled down to the course total.` });
    for (const a of allocs) {
      if (a.basis === 'unsure' || a.hours === null || a.hours === undefined || a.hours === '') {
        flags.push({ entryId: e.id, requirement: req.key, area: a.area, type: 'unsure_hours', message: `${e.title}: hours spent on ${a.topic && a.topic !== e.title ? `“${a.topic}”` : a.area ? `${req.areaTermShort} ${a.area}` : 'this topic'} are not known — left out of the estimate for admissions review.` });
        continue;
      }
      const hours = Number(a.hours) * scale;
      if (!(hours > 0)) continue;
      if (!a.area || !req.areas.some((x) => x.key === a.area)) {
        flags.push({ entryId: e.id, requirement: req.key, type: 'unassigned', message: `${e.title}: ${round(hours)} hours not yet assigned to a ${req.areaTerm} — left out until assigned.` });
        continue;
      }
      if (a.basis === 'self_reported') flags.push({ entryId: e.id, requirement: req.key, area: a.area, type: 'self_reported', message: `${e.title}: ${round(hours)} hours in ${req.areaTermShort} ${a.area} are self-reported (used provisionally).`, informational: true });
      pieces.push({
        entryId: e.id, area: a.area, hours: hours * mult.value,
        sync: e.delivery === 'synchronous',
        specific: req.specificMin ? a.sexualitySpecific !== false : true,
        couples: !!a.couples,
      });
    }
  }
  return pieces;
}

export function evaluateHoursRequirement(ruleset, req, entries, answers) {
  const flags = [];
  const pieces = collectPieces(ruleset, req, entries, flags);
  const areas = Object.fromEntries(req.areas.map((a) => [a.key, emptyArea(a)]));
  let countedSync = 0, countedSpecific = 0, countedCouples = 0;

  // Apply the per-area cap. Within an area, keep the hours that also satisfy
  // other sub-minimums first (couples, synchronous, sexuality-specific), so a cap
  // never discards hours the student needs elsewhere.
  for (const key of Object.keys(areas)) {
    const ps = pieces.filter((p) => p.area === key)
      .sort((x, y) => (y.couples - x.couples) || (y.sync - x.sync) || (y.specific - x.specific));
    let room = req.areaMax ?? Infinity;
    for (const p of ps) {
      areas[key].reported += p.hours;
      const used = Math.min(p.hours, room);
      room -= used;
      areas[key].counted += used;
      if (p.sync) countedSync += used;
      if (p.specific) countedSpecific += used;
      if (p.couples) countedCouples += used;
    }
    areas[key].excessOverCap = pos(areas[key].reported - areas[key].counted);
    areas[key].reported = round(areas[key].reported);
    areas[key].counted = round(areas[key].counted);
  }

  // Conditional sub-requirements (e.g., 16 hours of couples counseling within area C).
  const conditional = (req.conditional || []).map((c) => {
    const ans = answers?.[c.question] ?? 'unsure';
    const applies = ans === c.appliesWhen ? 'yes' : ans === 'unsure' ? 'unsure' : 'no';
    const shortfall = applies === 'yes' ? pos(c.hours - countedCouples) : 0;
    if (applies === 'unsure') flags.push({ requirement: req.key, type: 'conditional_unsure', message: `Whether the ${c.hours}-hour ${c.label} requirement applies is not confirmed — not included in the estimate; admissions will review.` });
    return { key: c.key, label: c.label, area: c.area, required: c.hours, counted: round(countedCouples), shortfall, applies };
  });

  for (const a of Object.values(areas)) {
    a.shortfall = pos(req.areaMin - a.counted);
    const cond = conditional.find((c) => c.area === a.key && c.shortfall > 0);
    // New couples hours land in their area, so the same hour meets both minimums.
    a.neededInArea = round(Math.max(a.shortfall, cond ? cond.shortfall : 0));
    if (a.excessOverCap > 0) flags.push({ requirement: req.key, area: a.key, type: 'cap', informational: true, message: `${req.areaTerm} ${a.key}: ${a.excessOverCap} hours above the ${req.areaMax}-hour maximum do not count toward the ${req.totalHours}-hour total.` });
  }

  const counted = round(Object.values(areas).reduce((s, a) => s + a.counted, 0));
  const areaShortfallTotal = round(Object.values(areas).reduce((s, a) => s + a.neededInArea, 0));
  const overallGap = pos(req.totalHours - counted);
  const syncShortfall = pos((req.synchronousMin || 0) - countedSync);
  const specificShortfall = req.specificMin ? pos(req.specificMin - countedSpecific) : 0;

  // Every additional hour can be placed in a short area, delivered synchronously
  // and be sexuality-specific, so one hour can close several gaps at once. The
  // hours still needed is therefore the largest gap, not the sum.
  const remaining = round(Math.max(areaShortfallTotal, overallGap, syncShortfall, specificShortfall));
  const binding = [
    ['area_minimums', areaShortfallTotal], ['overall_total', overallGap], ['synchronous', syncShortfall], ['specific', specificShortfall],
  ].filter(([, v]) => v === remaining && v > 0).map(([k]) => k);

  return {
    key: req.key, kind: 'hours', label: req.label, totalRequired: req.totalHours, counted,
    countedSync: round(countedSync), countedSpecific: round(countedSpecific),
    areas: Object.values(areas), areaShortfallTotal, overallGap, syncShortfall, specificShortfall,
    conditional, remaining, binding, flags,
  };
}

export function evaluateSupervision(req, entries, answers) {
  const flags = [];
  let total = req.totalHours, individualMin = req.individualMin, groupMax = req.groupMax;
  let alternativeApplied = false;
  if (req.alternative) {
    const ans = answers?.[req.alternative.question];
    if (ans === req.alternative.appliesWhen) {
      ({ totalHours: total, individualMin, groupMax } = req.alternative);
      alternativeApplied = true;
      flags.push({ requirement: req.key, type: 'alternative', informational: true, message: `Reduced supervision (${total} hours) applied for ${req.alternative.label}. ${req.alternative.note}` });
    } else if (ans === 'unsure') {
      flags.push({ requirement: req.key, type: 'alternative_unsure', message: `Eligibility for reduced supervision (${req.alternative.label}) is not confirmed — the standard ${req.totalHours} hours are used; admissions will review.` });
    }
  }
  let ind = 0, grp = 0, excluded = 0;
  for (const e of entries) {
    if (e.kind !== 'supervision') continue;
    const i = Number(e.individualHours) || 0, g = Number(e.groupHours) || 0;
    if (e.qualifies === 'yes') { ind += i; grp += g; }
    else {
      excluded += i + g;
      flags.push({ entryId: e.id, requirement: req.key, type: e.qualifies === 'no' ? 'supervision_not_qualifying' : 'supervision_unsure',
        message: e.qualifies === 'no'
          ? `${e.supervisorName || 'Supervision entry'}: ${i + g} hours were not with an ${'AASECT certified supervisor'} under a signed contract and do not count.`
          : `${e.supervisorName || 'Supervision entry'}: ${i + g} hours — supervisor certification/contract not confirmed; left out for admissions review.` });
    }
  }
  if (answers?.supervisionUnsure === 'yes') flags.push({ requirement: req.key, type: 'supervision_hours_unsure', message: 'You weren’t sure how many supervision hours you have — only the hours you entered are counted; admissions will review your supervision record.' });
  const countedGroup = Math.min(grp, groupMax);
  if (grp > groupMax) flags.push({ requirement: req.key, type: 'group_cap', informational: true, message: `${round(grp - groupMax)} group supervision hours exceed the ${groupMax}-hour group maximum and do not count.` });
  const counted = round(ind + countedGroup);
  const overallGap = pos(total - counted);
  const individualShortfall = pos(individualMin - ind);
  const remaining = round(Math.max(overallGap, individualShortfall));
  return {
    key: req.key, kind: 'supervision', label: req.label, totalRequired: total, individualRequired: individualMin, groupMax,
    countedIndividual: round(ind), countedGroup: round(countedGroup), groupExcess: pos(grp - groupMax), excludedHours: round(excluded),
    counted, overallGap, individualShortfall, remaining, alternativeApplied, minMonths: req.minMonths, maxHoursPerMonth: req.maxHoursPerMonth, flags,
  };
}

export function evaluateSar(req, entries, answers) {
  const flags = [];
  const sars = entries.filter((e) => e.kind === 'sar');
  const approvedHours = sars.filter((e) => e.aasectApproved === 'yes').reduce((s, e) => s + (Number(e.hours) || 0), 0);
  const unsure = sars.filter((e) => e.aasectApproved === 'unsure' || !(Number(e.hours) > 0));
  const answer = answers?.sarCompleted ?? (sars.length ? 'yes' : 'unsure');
  let status;
  if (approvedHours >= req.hours) status = 'met';
  else if (unsure.length || (answer === 'unsure' && !sars.length) || (answer === 'yes' && !sars.length)) status = 'review';
  else status = 'outstanding';
  if (status === 'review') flags.push({ requirement: 'sar', type: 'sar_review', message: `SAR completion could not be confirmed (needs ${req.hours} hours, AASECT sponsored or approved) — not included in the estimate; admissions will review.` });
  if (status === 'outstanding' && approvedHours > 0) flags.push({ requirement: 'sar', type: 'sar_partial', informational: true, message: `${round(approvedHours)} AASECT-approved SAR hours reported; ${req.hours} are required.` });
  return { key: 'sar', kind: 'sar', label: req.label, required: req.hours, approvedHours: round(approvedHours), status, flags };
}

export function evaluateOutside(ruleset, answers) {
  const items = [];
  for (const o of ruleset.outside || []) {
    const ans = answers?.[o.question];
    if (o.always) { items.push({ key: o.key, label: o.label, status: 'info' }); continue; }
    if (o.kind === 'hours') {
      const n = Number(ans);
      // These hour counts are no longer asked publicly; list them as general information.
      if (ans === undefined || ans === null || ans === '') items.push({ key: o.key, label: o.label, status: 'info' });
      else if (ans === 'unsure' || Number.isNaN(n)) items.push({ key: o.key, label: o.label, status: 'review' });
      else if (n < o.target) items.push({ key: o.key, label: o.label, status: 'remaining', detail: `${round(o.target - n)} hours appear to remain` });
      continue;
    }
    if (o.warnWhen?.includes(ans)) items.push({ key: o.key, label: o.label, status: 'warning' });
    else if (o.flagWhen?.includes(ans ?? 'unsure')) items.push({ key: o.key, label: o.label, status: ans === 'no' ? 'remaining' : 'review' });
  }
  return items;
}

export function evaluate(ruleset, intake) {
  const all = (intake.entries || []).filter((e) => !e.removed);
  const dupes = findDuplicates(all);
  const dropped = new Set(dupes.map((d) => d.dropId));
  const entries = all.filter((e) => !dropped.has(e.id));
  const answers = intake.answers || {};
  const results = {};
  for (const req of ruleset.requirements) {
    if (req.kind === 'hours') results[req.key] = evaluateHoursRequirement(ruleset, req, entries, answers);
    else if (req.kind === 'supervision') results[req.key] = evaluateSupervision(req, entries, answers);
    else if (req.kind === 'sar') results[req.key] = evaluateSar(req, entries, answers);
  }
  const duplicateFlags = dupes.map((d) => {
    const drop = all.find((e) => e.id === d.dropId), keep = all.find((e) => e.id === d.keepId);
    return { entryId: d.dropId, type: 'duplicate', informational: true, message: `“${drop.title || drop.supervisorName || 'Entry'}” looks like the same item as “${keep.title || keep.supervisorName || 'Entry'}” and is counted once.` };
  });
  return {
    rulesetId: ruleset.id, path: ruleset.path, version: ruleset.version,
    requirements: results, outside: evaluateOutside(ruleset, answers),
    duplicates: dupes, duplicateFlags, entryCount: entries.length,
  };
}
