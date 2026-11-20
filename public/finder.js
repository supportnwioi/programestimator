// Track finder: credential → Tier I · Core Program tuition right away → optional
// prior-training questions that show what may already be covered, what Core
// includes, and what may still be needed. Tier II · À La Carte is one total with
// a quantities-only list. All pricing comes from POST /api/track-estimate.
const $main = document.getElementById('finder');
const $bar = document.getElementById('price-bar');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PLANNING_COPY = 'This is a planning estimate. We’ll review your prior training and coursework options together and confirm your NWIOI tuition before you enroll.';
const PRIOR_COPY = 'See how far your prior training can take you. NWIOI Core includes 99 CEUs, supervision for your credential, and SAR. Graduate coursework and continuing education you’ve already completed may cover some or all of the remaining education. If you need additional courses, you can choose from the NWIOI library or learn with other institutes. We encourage you to learn from a range of educators and perspectives, and we’ll help you find courses that fit the areas you still need.';
const STORE_KEY = 'nwioi-finder-v3';

let config = null;
let result = null;
const freshAla = () => ({ coreCeus: null, skillsCeus: null, sar: null, individualHours: null, groupSessions: null });
const freshAdditional = () => ({ nwioiCeus: null, outsideCost: null });
const fresh = () => ({ path: null, showPrior: false, core: null, skills: null, supervision: null, sar: null, where: null, additional: freshAdditional(), alaCarte: freshAla() });
let state = fresh();

const deciding = () => state.path === 'deciding';
const pathCfg = () => config.paths.find((p) => p.path === state.path);
const anyAnswer = () => ['core', 'skills', 'supervision', 'sar', 'where'].some((k) => state[k] !== null && state[k] !== undefined);
function load() {
  try {
    const s = JSON.parse(sessionStorage.getItem(STORE_KEY));
    if (s) state = { ...fresh(), ...s, additional: { ...freshAdditional(), ...(s.additional || {}) }, alaCarte: { ...freshAla(), ...(s.alaCarte || {}) } };
  } catch { /* storage unavailable */ }
}
function save() { try { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ } }

// ------------------------------------------------------------------ links
function linkHtml(link, label, cls = '', testid = '') {
  const t = testid ? ` data-testid="${testid}"` : '';
  if (!link) return `<span class="${cls} disabled" aria-disabled="true"${t}>${esc(label)} <span class="small">(link coming soon)</span></span>`;
  return `<a class="${cls}" href="${esc(link.url)}" target="_blank" rel="noopener"${t}>${esc(label)}</a>${link.placeholder ? ' <span class="chip warn">Placeholder link · preview</span>' : ''}`;
}

// ------------------------------------------------------------------ questions
function statusText(v) {
  if (v === null || v === undefined) return 'Not answered yet';
  if (v === 'unsure') return 'You’re not sure';
  return `${v} hour${v === 1 ? '' : 's'}`;
}

function hoursQuestion(key, title, hint, max, scaleLabel) {
  const v = state[key];
  const answered = v !== null && v !== undefined, unsure = v === 'unsure';
  const n = typeof v === 'number' ? v : 0;
  return `
  <fieldset class="hours-q ${answered ? '' : 'unanswered'} ${unsure ? 'is-unsure' : ''}" data-q="${key}">
    <legend id="${key}-legend">${esc(title)}</legend>
    <p class="small muted" id="${key}-hint">${hint}</p>
    <div class="slider-row">
      <input type="range" min="0" max="${max}" step="1" value="${unsure ? 0 : n}" id="${key}-range" data-range="${key}"
        aria-labelledby="${key}-legend" aria-describedby="${key}-hint ${key}-status" aria-valuetext="${esc(statusText(v))}">
      <span class="num"><input type="number" inputmode="numeric" min="0" max="${max}" step="1" id="${key}-num" data-num="${key}"
        value="${answered && !unsure ? n : ''}" placeholder="—" aria-label="${esc(title)} (hours)"> <span aria-hidden="true">hours</span></span>
    </div>
    <div class="scale small muted" aria-hidden="true"><span>0</span><span>${max} · ${esc(scaleLabel)}</span></div>
    <div class="between q-foot">
      <span class="q-status small" id="${key}-status" aria-live="polite"><strong>${esc(statusText(v))}</strong></span>
      <span class="row">
        <button type="button" class="chip-btn" data-zero="${key}" aria-pressed="${answered && !unsure && n === 0}">None yet</button>
        <button type="button" class="chip-btn" data-unsure="${key}" aria-pressed="${unsure}">I’m not sure</button>
      </span>
    </div>
  </fieldset>`;
}

const radioGroup = (name, legend, options, value) => `
  <fieldset><legend>${esc(legend)}</legend>
    <div class="seg">${options.map(([k, l]) => `<label><input type="radio" name="${name}" value="${k}" ${value === k ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>
  </fieldset>`;

function priorIntro() {
  return `
  <section class="card prior-intro" data-testid="prior-intro">
    <h2 class="q-group">See how far your prior training can take you</h2>
    <p class="small">${esc(PRIOR_COPY.replace(/^See how far your prior training can take you\. /, ''))}</p>
    ${state.showPrior ? '' : '<button type="button" class="btn primary" data-show-prior data-testid="show-prior">See how your prior training could count</button>'}
  </section>`;
}

function questions(p) {
  const b = p.benchmarks;
  const ex = config.examples || {};
  return `
  <section class="card" id="prior-questions">
    <h2 class="q-group">See how your prior training could count</h2>
    <p class="small muted">Rough estimates of graduate coursework, training, and continuing education you’ve completed. The ${esc(p.pathName)} credential calls for ${b.core} core knowledge hours and ${b.skills} skills training hours. Extra hours in one category don’t count toward the other.</p>
    ${hoursQuestion('core', 'Core Knowledge Areas (CKAs)', `Up to ${b.core} hours. ${esc(ex.core || '')}`, b.core, 'core knowledge')}
    ${hoursQuestion('skills', b.trainingLabel, `Up to ${b.skills} hours. ${esc(ex.skills?.[p.path] || '')}`, b.skills, 'skills training')}
    <details class="credits">
      <summary>My coursework is listed in credits</summary>
      <p class="small">AASECT counts one college or university semester credit as ${b.semesterCreditClockHours} hours (a 3-credit semester course = ${3 * b.semesterCreditClockHours} hours). Continuing education from bodies other than AASECT counts at ${b.nonAasectCeMultiplier === 0.5 ? 'half' : `${b.nonAasectCeMultiplier}×`} value. Quarter credits have no published conversion, so admissions will review those with you.</p>
      <div class="row">
        <label class="small" for="credits-in" style="margin:0">Semester credits</label>
        <input type="number" id="credits-in" min="0" step="0.5" inputmode="decimal" style="max-width:110px">
        <span class="small" id="credits-out" aria-live="polite"></span>
      </div>
      <div class="row" style="margin-top:6px">
        <button type="button" data-add-credits="core">Add to core knowledge</button>
        <button type="button" data-add-credits="skills">Add to skills training</button>
      </div>
      <p class="small muted">Count each course once. If it’s already in your hours above, don’t add it again.</p>
    </details>
  </section>
  <section class="card">
    <h2 class="q-group">Supervision and SAR</h2>
    <p class="small muted">These help us show whether ${esc(config.tierNames?.alaCarte || 'À La Carte')} might fit better.</p>
    ${hoursQuestion('supervision', 'Supervision completed toward this credential',
      `Up to ${b.supervision} hours with an ${esc(p.terms.supervisorTitle)}.`,
      b.supervision, 'standard target')}
    ${radioGroup('sar', 'Have you completed a Sexuality Attitude Reassessment (SAR)?', [['yes', 'Yes'], ['no', 'No'], ['unsure', 'I’m not sure']], state.sar)}
    ${state.sar === 'yes' ? '<p class="small muted">Thanks. SAR is included in Core either way, and Core tuition stays the same. Admissions can confirm whether your SAR meets the requirement.</p>' : ''}
    ${radioGroup('where', 'Where would you like to do your supervision?', [['nwioi', 'With NWIOI'], ['outside', 'With an outside supervisor'], ['help', 'Help me decide']], state.where)}
  </section>`;
}

// ------------------------------------------------------------------ shared pieces
function priceBlock(t, { big = false } = {}) {
  const p = t.price;
  const id = big ? 'rec-price' : `price-${t.key}`;
  if (p.amount === null || p.amount === undefined) {
    return `<p class="${big ? 'range personal' : 'price-sm'}" data-testid="${id}">${esc(p.confirmText)}</p>`;
  }
  const pif = p.payInFull
    ? `<p class="pif" data-testid="${big ? 'rec-pif' : `pif-${t.key}`}"><strong>Pay in full · Save ${p.payInFull.percent}%:</strong> ${esc(p.payInFull.display)} <span class="small muted">(you save ${esc(p.payInFull.savings)})</span>${p.payInFull.draft ? ' <span class="chip warn">draft</span>' : ''}</p>`
    : '';
  return `<p class="price-label-sm small muted">${esc(p.label)}</p>
    <p class="${big ? 'range' : 'price-sm'}" data-testid="${id}">${esc(p.display)}</p>
    ${pif}
    ${t.paymentPlans?.length ? `<ul class="small plans">${t.paymentPlans.map((x) => `<li>or ${esc(x.text)}${x.draft ? ' <span class="chip warn">draft</span>' : ''}</li>`).join('')}</ul>` : ''}
    ${p.draft ? '<p><span class="chip warn">Draft pricing · preview only, pending NWIOI approval</span></p>' : ''}`;
}

function scholarshipBlock() {
  const s = result?.scholarship;
  if (!s) return '';
  return `<details class="scholarship" data-testid="scholarship">
    <summary>Explore scholarship and equity rates</summary>
    <p class="small"><strong>${esc(s.title)}</strong><br>${esc(s.copy)}</p>
    <p class="small muted">Scholarship awards, and whether they combine with pay-in-full savings, are subject to NWIOI review.</p>
    <div class="row">${linkHtml(s.application, 'View scholarship application', 'btn', 'scholarship-apply')} ${linkHtml(s.equity, 'Ask about equity rates', 'small', 'equity')}</div>
  </details>`;
}

// Expandable sections keep their open/closed state across live updates.
const openState = {};
const det = (id, summary, body, testid = '') => `<details id="${id}" class="expand"${openState[id] ? ' open' : ''}${testid ? ` data-testid="${testid}"` : ''}><summary>${summary}</summary>${body}</details>`;
const itemList = (items, testid) => `<ul class="item-list" data-testid="${testid}">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ------------------------------------------------------------------ prior training summary (under Tier I)
function priorSummary() {
  const pr = result.prior;
  const b = result.benchmarks;
  const trainingLower = b.trainingLabel.toLowerCase();
  const roughChip = pr.rough ? ' <span class="chip warn" data-testid="rough-chip">Rough planning estimate</span>' : '';
  const reviewNote = '<p class="small muted">Admissions reviews the topics and live hours of your prior training to confirm what counts.</p>';
  let covered, need, cost = '';

  if (pr.state === 'unresolved') {
    const parts = [];
    if (pr.knownCore !== null) parts.push(`${pr.knownCore} core knowledge hours`);
    if (pr.knownSkills !== null) parts.push(`${pr.knownSkills} ${trainingLower} hours`);
    covered = `<p>${parts.length ? `You’ve told us about ${esc(parts.join(' and '))}.` : 'Not answered yet.'} ${pr.unsure ? 'Some of your training still needs review, and we’ll go through it with you.' : 'Answer both education questions to see this.'}</p>`;
    need = `<p data-testid="prior-need">Still to be reviewed.${pr.rough ? ` Core covers ${pr.nwioiCeus} of the ${b.education} education hours, so up to ${pr.gapBeforePrior} more may be needed if none of your prior training counts.` : ''}</p>`;
  } else {
    const overlap = pr.overlap > 0
      ? `<p class="small muted" data-testid="prior-overlap">${plural(pr.overlap, 'hour')} you reported overlap${pr.overlap === 1 ? 's' : ''} with what Core already covers or go${pr.overlap === 1 ? 'es' : ''} beyond the requirement, so ${pr.overlap === 1 ? 'it isn’t' : 'they aren’t'} counted twice.</p>` : '';
    covered = `<p data-testid="prior-covered">About <strong>${plural(pr.counted, 'hour')}</strong> of your prior training may count toward the rest of the education requirement.</p>${overlap}`;
    if (pr.remaining === 0) {
      need = '<p data-testid="prior-need">Your prior training may cover the rest of the education requirement. No additional coursework estimated.</p>';
    } else {
      const split = pr.mappingKnown ? ` <span class="small">(${pr.remainingCore} core knowledge, ${pr.remainingSkills} ${esc(trainingLower)})</span>` : '';
      need = `<p data-testid="prior-need">About <strong>${plural(pr.remaining, 'more CEU')}</strong>${split}</p>`;
      const max = pr.remaining;
      cost = `
      <div class="additional">
        <div class="grid2">
          <div class="field"><label for="add-nwioi">CEUs you’d take with NWIOI</label>
            <input type="number" id="add-nwioi" data-add="nwioiCeus" min="0" max="${max}" step="1" inputmode="numeric" value="${pr.nwioiAdditionalCeus}">
            <span class="small muted">${esc(pr.libraryNote || '')}</span></div>
          ${pr.outsideCeus > 0 ? `<div class="field"><label for="add-outside">Expected cost of your other ${plural(pr.outsideCeus, 'CEU')} (optional)</label>
            <input type="number" id="add-outside" data-add="outsideCost" min="0" step="1" inputmode="decimal" value="${pr.outsideCost ?? ''}" placeholder="$">
            <span class="small muted">Other providers set their own prices.</span></div>` : ''}
        </div>
        <table class="math combined-table" data-testid="combined-table"><tbody>
          <tr><td>NWIOI tuition · ${esc(result.tierNames.core)}</td><td class="amt">${esc(result.tracks.core.price.display || '—')}</td></tr>
          ${pr.nwioiAdditionalCeus > 0 ? `<tr><td>Additional NWIOI coursework · ${plural(pr.nwioiAdditionalCeus, 'CEU')}</td><td class="amt" data-testid="additional-cost">${esc(pr.additional?.display || 'Confirm with admissions')}</td></tr>` : ''}
          ${pr.outsideCeus > 0 ? `<tr><td>Coursework with other institutes · ${plural(pr.outsideCeus, 'CEU')}</td><td class="amt">${pr.outsideCost !== null ? esc('$' + Math.round(pr.outsideCost).toLocaleString('en-US')) : '<span class="muted">Not included</span>'}</td></tr>` : ''}
          ${pr.combined ? `<tr class="total"><td>Estimated combined cost${pr.combined.complete ? '' : ' <span class="small muted">(without other institutes)</span>'}</td><td class="amt" data-testid="combined-cost">${esc(pr.combined.display)}</td></tr>` : ''}
        </tbody></table>
        ${pr.combined ? `<p class="planning small" data-testid="planning">${esc(PLANNING_COPY)}</p>` : ''}
      </div>`;
    }
  }
  return `
  <section class="prior-summary" data-testid="prior-summary" aria-live="polite">
    <h3 class="small-h">How your prior training could count${roughChip}</h3>
    <ol class="steps">
      <li><strong>What you may already have covered</strong>${covered}</li>
      <li><strong>What NWIOI includes</strong><p data-testid="prior-includes">${pr.nwioiCeus} CEUs of NWIOI coursework, plus supervision and SAR.</p></li>
      <li><strong>What you may still need</strong>${need}</li>
    </ol>
    ${cost}
    ${reviewNote}
  </section>`;
}

// ------------------------------------------------------------------ À La Carte
function alaControls(t) {
  const s = t.selection, sug = t.suggestion, u = t.units;
  const num = (id, key, label, max, hint) => `<div class="field"><label for="${id}">${esc(label)}</label>
      <input type="number" id="${id}" data-ala="${key}" min="0" ${max ? `max="${max}"` : ''} step="1" inputmode="numeric" value="${s[key] ?? ''}" placeholder="Choose">
      <span class="small muted">${hint}</span></div>`;
  const sugText = (v) => (v !== null ? `Suggested from your answers: ${v} remaining` : 'Needs review. Choose a number or ask admissions.');
  const adjust = `
    <div class="grid2">
      ${num('ala-core', 'coreCeus', 'Core Knowledge CEUs', result.benchmarks.core, sugText(sug.coreCeus))}
      ${num('ala-skills', 'skillsCeus', `${u.trainingLabel} CEUs`, result.benchmarks.skills, sugText(sug.skillsCeus))}
    </div>
    ${t.outsideSupervision ? '' : `<div class="grid2">
      ${num('ala-ind', 'individualHours', 'Hours of individual supervision', null, 'One-to-one with an NWIOI supervisor')}
      ${num('ala-grp', 'groupSessions', 'Group supervision sessions', null, `${u.groupSessionHours} hours each`)}
    </div>`}`;
  return `
  <div class="modular-controls">
    ${t.sarOffer ? `<label class="small sar-offer" style="font-weight:400"><input type="checkbox" data-ala="sar" ${s.sar ? 'checked' : ''}> ${esc(t.sarOffer)}</label>` : ''}
    ${t.items.length ? det('ala-included', 'See what’s included', itemList(t.items, 'ala-items'), 'ala-included') : ''}
    ${det('ala-adjust', 'Change what you’d buy', adjust, 'ala-adjust')}
  </div>`;
}

function alaCard() {
  const t = result.tracks.alaCarte;
  const rec = result.recommended === 'alaCarte';
  const p = t.price;
  const known = p.amount !== null && p.amount !== undefined;
  return `<article class="track-card ${rec ? 'is-recommended' : ''}" data-track="alaCarte">
    ${rec ? '<span class="chip ok">Recommended for you</span>' : ''}
    <h3>${esc(t.name)}</h3>
    <p class="price-label-sm small muted">Estimated cost if purchased separately</p>
    <p class="price-sm" data-testid="price-alaCarte">${esc(known ? p.display : p.confirmText)}${known && p.complete === false ? ' <span class="small muted">so far</span>' : ''}</p>
    ${p.draft ? '<p><span class="chip warn">Draft pricing · preview only, pending NWIOI approval</span></p>' : ''}
    ${t.basedOn ? `<p class="small muted" data-testid="based-on">${esc(t.basedOn)}</p>` : ''}
    ${alaControls(t)}
    ${t.notes?.length ? `<ul class="small notes" data-testid="ala-notes">${t.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <ul class="small included">${t.included.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <div class="cta">${linkHtml(t.cta.link, t.cta.label, 'btn', 'cta-alaCarte')} ${linkHtml(t.secondary.link, t.secondary.label, 'small')}</div>
    ${result.library ? `<p class="small muted">${esc(result.prior.libraryNote || '')}</p>` : ''}
  </article>`;
}

function coreCard() {
  const t = result.tracks.core;
  const rec = result.recommended === 'core';
  const s = result.savings;
  return `<article class="track-card ${rec ? 'is-recommended' : ''}" data-track="core">
    ${rec ? '<span class="chip ok">Recommended for you</span>' : ''}
    <h3>${esc(t.name)}</h3>
    ${priceBlock(t)}
    ${s ? `<p class="small savings" data-testid="savings"><strong>Save ${esc(s.display)}</strong> compared with buying the same items separately (${esc(s.separately)}).</p>
      ${det('savings-items', 'Same items compared', itemList(s.items, 'savings-items'), 'savings-included')}` : ''}
    <ul class="small included">${t.included.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <div class="cta">${linkHtml(t.cta.link, t.cta.label, 'btn', 'cta-core')}</div>
  </article>`;
}

// ------------------------------------------------------------------ result panel (Tier I is the center)
function resultPanel() {
  if (!state.path) return `<h2 class="price-label">Your NWIOI tuition</h2><p class="muted">Choose the credential you’re working toward to see Core Program tuition and what’s included.</p>`;
  if (deciding()) {
    return `<h2 class="price-label">Not sure which credential fits?</h2>
      <p>Sex therapist, sexuality counselor and sexuality educator credentials have different training and supervision requirements. In a free admissions call, we’ll talk about your background and goals, explain how each credential works, and help you choose a direction.</p>
      <div class="cta">${linkHtml(config.links.scheduling, 'Talk through my options', 'btn primary big', 'primary-cta')}</div>
      <p class="small muted">NWIOI provides training. AASECT makes certification decisions.</p>`;
  }
  if (!result) return `<h2 class="price-label">Your NWIOI tuition</h2><p class="muted">Loading…</p>`;
  const t = result.tracks.core;
  const ala = result.tracks.alaCarte;
  const alaRec = result.recommended === 'alaCarte';
  const heading = result.recommended === 'core'
    ? `<span class="chip ok" data-testid="rec-chip">Recommended for you</span><p class="small muted" style="margin-top:6px">For the ${esc(result.pathName)} credential</p>`
    : `<p class="small muted">For the ${esc(result.pathName)} credential</p>`;
  const alaCallout = alaRec ? `
    <div class="compare-live" data-testid="ala-callout">
      <span class="chip ok">Recommended for you: ${esc(ala.name)}</span>
      <span class="small">Estimated cost if purchased separately</span>
      <strong data-testid="ala-live-price">${esc(ala.price.amount !== null && ala.price.amount !== undefined ? ala.price.display : ala.price.confirmText)}</strong>
      <ul class="small reasons" data-testid="reasons">${result.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      <a href="#compare" data-open-compare class="small">Compare both tiers</a>
    </div>` : '';
  return `${heading}
    <h2 class="rec-name" data-testid="rec-name">${esc(t.name)}</h2>
    ${t.lead ? `<p class="lead">${esc(t.lead)}</p>` : ''}
    <div aria-live="polite" aria-atomic="true">${priceBlock(t, { big: true })}</div>
    ${scholarshipBlock()}
    <h3 class="small-h">What’s included</h3>
    <ul class="small included" data-testid="core-included">${t.included.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    ${alaCallout}
    ${state.showPrior || anyAnswer() ? priorSummary() : `<p><button type="button" class="btn" data-show-prior>See how your prior training could count</button></p>`}
    ${result.recommended === 'core' ? `<h3 class="small-h">Why it fits</h3><ul class="small reasons" data-testid="reasons">${result.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    ${result.notes.length ? `<ul class="small notes" data-testid="notes">${result.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <div class="cta">
      ${linkHtml(t.cta.link, t.cta.label, 'btn primary big', 'primary-cta')}
      ${linkHtml(t.secondary.link, t.secondary.label, 'btn', 'secondary-cta')}
    </div>
    <p class="small muted" data-testid="library-note">${esc(result.prior.libraryNote || '')}</p>
    ${t.enroll ? `<p class="small">${linkHtml(t.enroll, 'Ready to enroll? Start your Core enrollment', 'small', 'enroll')}</p>` : ''}
    ${t.extraLinks?.length ? `<p class="small">${t.extraLinks.map((x) => linkHtml(x.link, x.label, 'small')).join(' · ')}</p>` : ''}
    <p class="small muted">NWIOI provides training. AASECT makes certification decisions.</p>`;
}

function compareSection(openNow) {
  if (!result || deciding()) return '';
  return `<details id="compare" class="compare" ${openNow ? 'open' : ''}>
    <summary><h2 id="compare-h">Compare ${esc(result.tierNames.core)} and ${esc(result.tierNames.alaCarte)}</h2></summary>
    <p class="small muted">${esc(result.tierNames.core)} has a fixed tuition that includes SAR. ${esc(result.tierNames.alaCarte)} lets you buy individual courses, supervision or SAR, so its estimate changes with what you choose.</p>
    <div class="track-grid">${coreCard()}${alaCard()}</div>
  </details>`;
}

// The live number: pinned to the top of the screen, updates as answers change.
let lastBarValue = null;
function renderBar() {
  let label = 'Standard NWIOI tuition', name = '', value = '—', sub = 'Choose a credential to see your tuition', valueClass = 'muted-value', draft = false;
  if (deciding()) {
    label = 'Not sure which credential?'; value = 'Let’s talk'; sub = 'A free admissions call can help you choose'; valueClass = '';
  } else if (state.path && result) {
    const alaRec = result.recommended === 'alaCarte';
    const t = alaRec ? result.tracks.alaCarte : result.tracks.core;
    const known = t.price.amount !== null && t.price.amount !== undefined;
    name = t.name;
    label = known ? (alaRec ? 'Estimated cost with NWIOI' : t.price.label) : 'Your NWIOI tuition';
    value = known ? t.price.display + (t.price.complete === false ? '+' : '') : t.price.confirmText;
    valueClass = known ? '' : 'confirm-value';
    const parts = [];
    if (!alaRec && t.price.payInFull) parts.push(`Pay in full: ${t.price.payInFull.display}`);
    const comb = result.prior?.combined;
    if (!alaRec && comb && result.prior.remaining > 0) parts.push(`Estimated combined cost: ${comb.display}${comb.complete ? '' : '+'}`);
    if (alaRec && known) parts.push('Planning estimate');
    sub = parts.length ? parts.join(' · ') : known ? 'Planning estimate' : 'We’ll confirm your tuition';
    draft = Boolean(t.price.draft);
  } else if (state.path) sub = 'Updating…';
  const changed = lastBarValue !== null && lastBarValue !== name + value + sub;
  lastBarValue = name + value + sub;
  $bar.innerHTML = `<div class="wrap estimate-inner">
      <div class="estimate-text" aria-live="polite" aria-atomic="true">
        <span class="estimate-label">${esc(label)}${name ? ` · <strong>${esc(name)}</strong>` : ''}${draft ? ' <span class="chip draft-chip">Draft</span>' : ''}</span>
        <span class="estimate-value ${valueClass}" data-testid="bar-price">${esc(value)}</span>
        <span class="estimate-sub" data-testid="bar-sub">${esc(sub)}</span>
      </div>
      <span class="bar-cta">${linkHtml(config.links.scheduling, 'Book a free admissions call', 'btn bar-btn', 'bar-book')}</span>
    </div>`;
  if (changed) {
    const el = $bar.querySelector('.estimate-value');
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }
}

// Re-render result areas while keeping focus/caret in a control the visitor is using.
function withFocus(fn) {
  const a = document.activeElement;
  const id = a?.id;
  fn();
  if (id) { const el = document.getElementById(id); if (el && el !== document.activeElement) el.focus(); }
}
const lastLive = {};
function flashChanged(selector) {
  const el = $main.querySelector(selector);
  if (!el) return;
  if (lastLive[selector] !== undefined && lastLive[selector] !== el.textContent) el.classList.add('flash');
  lastLive[selector] = el.textContent;
}
function renderResult() {
  withFocus(() => {
    const aside = $main.querySelector('.quick-price');
    if (aside) aside.innerHTML = resultPanel();
    const cmp = $main.querySelector('#compare-wrap');
    const wasOpen = Boolean(cmp?.querySelector('#compare')?.open);
    if (cmp) cmp.innerHTML = compareSection(wasOpen);
    for (const sel of ['[data-testid="combined-cost"]', '[data-testid="ala-live-price"]', '[data-testid="price-alaCarte"]']) flashChanged(sel);
  });
  renderBar();
}

function render() {
  const p = state.path && !deciding() ? pathCfg() : null;
  $main.innerHTML = `
  <section class="intro">
    <h1>Find your NWIOI path and tuition</h1>
    <p>Choose your credential to see Core Program tuition and what’s included. Then see how your prior training could count.</p>
    <p class="small muted">Your credential (set by AASECT) determines the training you need. Your NWIOI tier determines what you buy from NWIOI.</p>
    ${config.preview ? '<p class="notice warn small">Preview mode: draft prices and placeholder links are visible and labeled. The public sees only approved offers.</p>' : ''}
  </section>
  <div class="quick-grid">
    <div class="quick-inputs">
      <section class="card">
        ${radioGroup('path', 'Which credential are you working toward?', [...config.paths.filter((x) => x.enabled).map((x) => [x.path, x.pathName]), ['deciding', 'I’m still deciding']], state.path)}
      </section>
      ${p ? priorIntro() : ''}
      ${p && state.showPrior ? questions(p) : ''}
    </div>
    <aside class="quick-price card" aria-label="Your NWIOI tuition">${resultPanel()}</aside>
  </div>
  <div id="compare-wrap">${compareSection(false)}</div>`;
  renderBar();
  $main.setAttribute('aria-busy', 'false');
}

function syncQuestion(key) {
  const fs = $main.querySelector(`[data-q="${key}"]`);
  if (!fs) return;
  const v = state[key];
  const answered = v !== null && v !== undefined, unsure = v === 'unsure';
  const n = typeof v === 'number' ? v : 0;
  fs.classList.toggle('unanswered', !answered);
  fs.classList.toggle('is-unsure', unsure);
  const range = fs.querySelector('[data-range]'), num = fs.querySelector('[data-num]');
  if (document.activeElement !== range) range.value = unsure ? 0 : n;
  if (document.activeElement !== num) num.value = answered && !unsure ? n : '';
  range.setAttribute('aria-valuetext', statusText(v));
  fs.querySelector('.q-status strong').textContent = statusText(v);
  fs.querySelector('[data-zero]').setAttribute('aria-pressed', String(answered && !unsure && n === 0));
  fs.querySelector('[data-unsure]').setAttribute('aria-pressed', String(unsure));
}

// ------------------------------------------------------------------ estimate
let timer = null, controller = null, seq = 0;
function requestEstimate(immediate = false) {
  save();
  clearTimeout(timer);
  if (!state.path || deciding()) { result = null; renderResult(); return; }
  timer = setTimeout(async () => {
    controller?.abort();
    controller = new AbortController();
    const mine = ++seq;
    try {
      const res = await fetch('/api/track-estimate', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ path: state.path, core: state.core, skills: state.skills, supervision: state.supervision, sar: state.sar, supervisionWhere: state.where, additional: state.additional, alaCarte: state.alaCarte }),
      });
      const body = await res.json();
      if (mine !== seq) return;
      if (!res.ok) throw new Error(body.error || 'Unavailable');
      result = body;
      renderResult();
    } catch (err) {
      if (err.name === 'AbortError') return;
      const aside = $main.querySelector('.quick-price');
      if (aside) aside.innerHTML = `<p>We couldn’t load tuition right now.</p><div class="cta">${linkHtml(config.links.scheduling, 'Book a free admissions call', 'btn primary big', 'primary-cta')}</div>`;
    }
  }, immediate ? 0 : 120);
}

function setHours(key, value) {
  const max = pathCfg().benchmarks[key];
  if (value === 'unsure' || value === null) state[key] = value;
  else state[key] = Math.max(0, Math.min(max, Math.round(Number(value))));
  // Hours answers change the suggested quantities; drop stale overrides.
  if (key === 'core' || key === 'skills') { state.additional = freshAdditional(); state.alaCarte[key === 'core' ? 'coreCeus' : 'skillsCeus'] = null; }
  if (key === 'supervision') { state.alaCarte.individualHours = null; state.alaCarte.groupSessions = null; }
  syncQuestion(key);
  requestEstimate();
}

function showPrior() {
  state.showPrior = true;
  save();
  render();
  requestEstimate(true);
  const q = $main.querySelector('#prior-questions');
  q?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  q?.querySelector('input')?.focus({ preventScroll: true });
}

// ------------------------------------------------------------------ events
$main.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.range) setHours(t.dataset.range, t.value);
  else if (t.dataset.num) { if (t.value !== '') setHours(t.dataset.num, t.value); }
  else if (t.id === 'credits-in') {
    const c = Number(t.value);
    $main.querySelector('#credits-out').textContent = c > 0 ? `= ${c * pathCfg().benchmarks.semesterCreditClockHours} hours` : '';
  } else if (t.dataset.ala && t.type === 'number') {
    state.alaCarte[t.dataset.ala] = t.value === '' ? null : Math.max(0, Math.round(Number(t.value)));
    requestEstimate();
  } else if (t.dataset.add) {
    const v = t.value === '' ? null : Math.max(0, Number(t.value));
    state.additional[t.dataset.add] = t.dataset.add === 'nwioiCeus' && v !== null ? Math.round(v) : v;
    requestEstimate();
  }
});

$main.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.name === 'path') {
    const prev = state.path;
    state.path = t.value;
    if (prev !== t.value) { state.alaCarte = freshAla(); state.additional = freshAdditional(); }
    if (!deciding()) for (const k of ['core', 'skills', 'supervision']) if (typeof state[k] === 'number') state[k] = Math.min(state[k], pathCfg().benchmarks[k]);
    result = null;
    render();
    $main.querySelector(`input[name="path"][value="${t.value}"]`)?.focus();
    requestEstimate(true);
  } else if (t.name === 'sar' || t.name === 'where') {
    state[t.name] = t.value;
    if (t.name === 'sar') state.alaCarte.sar = null;
    if (t.name === 'where') { state.alaCarte.individualHours = null; state.alaCarte.groupSessions = null; }
    const scrollY = window.scrollY;
    render();
    window.scrollTo(0, scrollY);
    $main.querySelector(`input[name="${t.name}"][value="${t.value}"]`)?.focus();
    requestEstimate(true);
  } else if (t.dataset.num && t.value === '') setHours(t.dataset.num, null);
  else if (t.dataset.ala === 'sar') { state.alaCarte.sar = t.checked; requestEstimate(true); }
});

$main.addEventListener('toggle', (ev) => { if (ev.target.matches?.('details.expand')) openState[ev.target.id] = ev.target.open; }, true);

$main.addEventListener('click', (ev) => {
  const open = ev.target.closest('[data-open-compare]');
  if (open) {
    ev.preventDefault();
    const d = $main.querySelector('#compare');
    if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    return;
  }
  const t = ev.target.closest('button');
  if (!t) return;
  if ('showPrior' in t.dataset) showPrior();
  else if (t.dataset.zero) setHours(t.dataset.zero, 0);
  else if (t.dataset.unsure) setHours(t.dataset.unsure, state[t.dataset.unsure] === 'unsure' ? null : 'unsure');
  else if (t.dataset.addCredits) {
    const c = Number($main.querySelector('#credits-in').value);
    if (!(c > 0)) return;
    const key = t.dataset.addCredits;
    const add = c * pathCfg().benchmarks.semesterCreditClockHours;
    setHours(key, (typeof state[key] === 'number' ? state[key] : 0) + add);
    $main.querySelector('#credits-in').value = '';
    $main.querySelector('#credits-out').textContent = `Added ${add} hours to ${key === 'core' ? 'core knowledge' : 'skills training'}.`;
  }
});

(async () => {
  try {
    config = await (await fetch('/api/config')).json();
    load();
    if (state.path && state.path !== 'deciding' && !config.paths.some((x) => x.path === state.path && x.enabled)) state = fresh();
    if (anyAnswer()) state.showPrior = true;
    render();
    if (state.path) requestEstimate(true);
  } catch {
    $main.innerHTML = '<div class="card"><p>The track finder could not load. Please try again later.</p></div>';
  }
})();
