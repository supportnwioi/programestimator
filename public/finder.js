// Track finder: headline → credential picker → two compact option cards
// (Core Program · Tier I and À La Carte · Tier II) → the flow the visitor picks,
// with its personalized result directly beneath the inputs.
// All pricing comes from POST /api/track-estimate (server-side catalog).
const $main = document.getElementById('finder');
const $bar = document.getElementById('price-bar');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PLANNING_COPY = 'This is a planning estimate. We’ll review your prior training and coursework options together and confirm your NWIOI tuition before you enroll.';
const PRIOR_COPY = 'NWIOI Core includes 99 CEUs, supervision for your credential, and SAR. Graduate coursework and continuing education you’ve already completed may cover some or all of the remaining education. If you need additional courses, you can choose from the NWIOI library or learn with other institutes. We encourage you to learn from a range of educators and perspectives, and we’ll help you find courses that fit the areas you still need.';
const STORE_KEY = 'nwioi-finder-v4';

let config = null;
let result = null;
const freshAla = () => ({ coreCeus: null, skillsCeus: null, sar: null, individualHours: null, groupSessions: null });
const freshAdditional = () => ({ nwioiCeus: null, outsideCost: null });
// mode: null (just the option cards) | 'prior' (Core: prior-training calculator) | 'ala' (À La Carte builder)
const fresh = () => ({ path: null, mode: null, alaStarted: false, core: null, skills: null, supervision: null, sar: null, where: null, additional: freshAdditional(), alaCarte: freshAla() });
let state = fresh();

const deciding = () => state.path === 'deciding';
const pathCfg = () => config.paths.find((p) => p.path === state.path);
const known = (p) => p && p.amount !== null && p.amount !== undefined;
function load() {
  try {
    const s = JSON.parse(sessionStorage.getItem(STORE_KEY));
    if (s) state = { ...fresh(), ...s, additional: { ...freshAdditional(), ...(s.additional || {}) }, alaCarte: { ...freshAla(), ...(s.alaCarte || {}) } };
  } catch { /* storage unavailable */ }
}
function save() { try { sessionStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ } }

// ------------------------------------------------------------------ small helpers
function linkHtml(link, label, cls = '', testid = '') {
  const t = testid ? ` data-testid="${testid}"` : '';
  if (!link) return `<span class="${cls} disabled" aria-disabled="true"${t}>${esc(label)} <span class="small">(link coming soon)</span></span>`;
  return `<a class="${cls}" href="${esc(link.url)}" target="_blank" rel="noopener"${t}>${esc(label)}</a>${link.placeholder ? ' <span class="chip warn">Placeholder link · preview</span>' : ''}`;
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const openState = {};
const det = (id, summary, body, testid = '') => `<details id="${id}" class="expand"${openState[id] ? ' open' : ''}${testid ? ` data-testid="${testid}"` : ''}><summary>${summary}</summary>${body}</details>`;
const itemList = (items, testid) => `<ul class="item-list" data-testid="${testid}">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
const draftChip = (on) => (on ? ' <span class="chip warn">Draft · preview only</span>' : '');

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

// ------------------------------------------------------------------ the two option cards (right under the picker)
function coreOption() {
  const t = result.tracks.core;
  const p = t.price;
  const rec = result.recommended === 'core';
  const priceHtml = known(p)
    ? `<p class="opt-price" data-testid="rec-price">${esc(p.display)}</p>
       <p class="small opt-sub">Standard NWIOI tuition${p.payInFull ? ` · <span data-testid="rec-pif">Pay in full: ${esc(p.payInFull.display)} (save ${p.payInFull.percent}%)</span>` : ''}${draftChip(p.draft)}</p>
       ${t.paymentPlans?.length ? `<p class="small opt-sub">${t.paymentPlans.map((x) => `or ${esc(x.text)}`).join(' · ')}</p>` : ''}`
    : `<p class="opt-price confirm" data-testid="rec-price">${esc(p.confirmText)}</p>`;
  return `<article class="opt-card ${rec ? 'is-recommended' : ''}" data-track="core" aria-labelledby="opt-core-h">
    <h2 id="opt-core-h" class="opt-h"><span class="opt-name">Core Program</span> <span class="tier">Tier I</span></h2>
    ${rec ? '<span class="chip ok" data-testid="rec-chip">Recommended for you</span>' : ''}
    ${priceHtml}
    <p class="opt-key" data-testid="core-key">99 CEUs, supervision, and SAR included</p>
    ${t.lead ? `<p class="small">${esc(t.lead)}</p>` : ''}
    <button type="button" class="btn primary opt-btn" data-mode="prior" data-testid="core-action" aria-pressed="${state.mode === 'prior'}">See what my prior training could save</button>
    ${scholarshipBlock()}
  </article>`;
}

function alaOption() {
  const t = result.tracks.alaCarte;
  const rec = result.recommended === 'alaCarte';
  const showTotal = state.alaStarted && known(t.price) && (t.items.length || t.price.complete);
  return `<article class="opt-card ${rec ? 'is-recommended' : ''}" data-track="alaCarte" aria-labelledby="opt-ala-h">
    <h2 id="opt-ala-h" class="opt-h"><span class="opt-name">À La Carte</span> <span class="tier">Tier II</span></h2>
    ${rec ? '<span class="chip ok">Recommended for you</span>' : ''}
    ${showTotal
      ? `<p class="opt-price" data-testid="ala-card-price">${esc(t.price.display)}${t.price.complete === false ? '<span class="small muted"> so far</span>' : ''}</p>
         <p class="small opt-sub">Estimated cost if purchased separately${draftChip(t.price.draft)}</p>`
      : '<p class="opt-price opt-price-text">Pay for what you need</p><p class="small opt-sub">Your estimated total appears once you make selections.</p>'}
    <p class="opt-key">Choose individual courses, supervision, or SAR.</p>
    <button type="button" class="btn primary opt-btn" data-mode="ala" data-testid="ala-action" aria-pressed="${state.mode === 'ala'}">Build my estimate</button>
  </article>`;
}

function compareDetails() {
  const core = result.tracks.core, ala = result.tracks.alaCarte, s = result.savings;
  const supervision = core.included.find((x) => x.startsWith('Supervision')) || 'Included';
  const rows = [
    ['Education', '99 CEUs of NWIOI coursework', 'The courses you choose'],
    ['Supervision', esc(supervision.replace(/^Supervision: /, '')), 'NWIOI hours and group sessions as you need them, or an outside supervisor (paid separately)'],
    ['SAR', 'Included', 'Add if you need one'],
    ['Price', `Fixed tuition${known(core.price) ? `: ${esc(core.price.display)}` : ''}`, 'One estimate for what you buy'],
    ['Pay in full', core.price.payInFull ? `Save ${core.price.payInFull.percent}%: ${esc(core.price.payInFull.display)}` : 'Ask admissions', 'Not available'],
    ['Good fit if', 'You want a complete, guided path with supervision', 'You’ve completed much of your training or have your own supervisor'],
  ];
  return `<details id="compare" class="compare"${openState.compare ? ' open' : ''}>
    <summary><span id="compare-h">Compare full details</span></summary>
    <div class="table-wrap"><table class="compare-table" data-testid="compare-table">
      <thead><tr><th scope="col"><span class="sr-only">Detail</span></th><th scope="col">Core Program <span class="tier">Tier I</span></th><th scope="col">À La Carte <span class="tier">Tier II</span></th></tr></thead>
      <tbody>${rows.map(([h, a, b]) => `<tr><th scope="row">${h}</th><td>${a}</td><td>${b}</td></tr>`).join('')}</tbody>
    </table></div>
    ${s ? `<p class="small savings" data-testid="savings"><strong>Core saves ${esc(s.display)}</strong> compared with buying the same items separately (${esc(s.separately)}).</p>
      ${det('savings-items', 'Same items compared', itemList(s.items, 'savings-items'), 'savings-included')}` : ''}
    <p class="small muted">${esc(core.name)} also includes: ${core.included.filter((x) => !/^(99 CEUs|Supervision|SAR)/.test(x)).map(esc).join(' · ')}.</p>
    ${core.extraLinks?.length ? `<p class="small">${core.extraLinks.map((x) => linkHtml(x.link, x.label, 'small')).join(' · ')}</p>` : ''}
  </details>`;
}

function optionsSection() {
  if (!state.path) return '';
  if (deciding()) {
    return `<section class="card" data-testid="deciding">
      <h2>Not sure which credential fits?</h2>
      <p>Sex therapist, sexuality counselor and sexuality educator credentials have different training and supervision requirements. In a free admissions call, we’ll talk about your background and goals, explain how each credential works, and help you choose a direction.</p>
      <div class="cta">${linkHtml(config.links.scheduling, 'Talk through my options', 'btn primary big', 'primary-cta')}</div>
      <p class="small muted">NWIOI provides training. AASECT makes certification decisions.</p>
    </section>`;
  }
  if (!result) return '<p class="muted" aria-live="polite">Loading tuition…</p>';
  return `<p class="small muted options-for">Your options for the <strong>${esc(result.pathName)}</strong> credential</p>
    <div class="opt-grid" data-testid="options">${coreOption()}${alaOption()}</div>
    ${compareDetails()}`;
}

// ------------------------------------------------------------------ Core: prior-training calculator
function priorFlow(p) {
  const b = p.benchmarks;
  const ex = config.examples || {};
  return `
  <section class="card flow" id="prior-flow" aria-labelledby="prior-h">
    <h2 id="prior-h">See what your prior training could save</h2>
    <p class="small muted">Rough estimates are fine. The ${esc(p.pathName)} credential calls for ${b.core} core knowledge hours and ${b.skills} skills training hours, and extra hours in one category don’t count toward the other.</p>
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
    <div id="prior-result" class="result-box" aria-live="polite">${result ? priorResult() : ''}</div>
    <div class="prior-copy" data-testid="prior-copy"><h3 class="small-h">See how far your prior training can take you</h3><p class="small">${esc(PRIOR_COPY)}</p></div>
  </section>`;
}

function priorResult() {
  const pr = result.prior;
  const b = result.benchmarks;
  const core = result.tracks.core;
  const trainingLower = b.trainingLabel.toLowerCase();
  const roughChip = pr.rough ? ' <span class="chip warn" data-testid="rough-chip">Rough planning estimate</span>' : '';
  const cta = `<div class="cta">${linkHtml(core.cta.link, core.cta.label, 'btn primary big', 'primary-cta')} ${linkHtml(core.secondary.link, core.secondary.label, 'btn', 'secondary-cta')}</div>
    <p class="small muted" data-testid="library-note">${esc(pr.libraryNote || '')}</p>
    ${core.enroll ? `<p class="small">${linkHtml(core.enroll, 'Ready to enroll? Start your Core enrollment', 'small', 'enroll')}</p>` : ''}`;
  const review = '<p class="small muted">Admissions reviews the topics and live hours of your prior training to confirm what counts.</p>';

  if (pr.state === 'unresolved') {
    const parts = [];
    if (pr.knownCore !== null) parts.push(`${pr.knownCore} core knowledge hours`);
    if (pr.knownSkills !== null) parts.push(`${pr.knownSkills} ${trainingLower} hours`);
    if (!parts.length && !pr.unsure) return '<p class="muted" data-testid="prior-empty">Enter your hours above to see what your prior training could save.</p>';
    return `<div data-testid="prior-summary">
      <p>${parts.length ? `You’ve told us about ${esc(parts.join(' and '))}.` : ''} ${pr.unsure ? 'Some of your training still needs review, and we’ll go through it with you.' : 'Answer both questions to see your estimate.'}</p>
      <p data-testid="prior-need">Still to be reviewed.${pr.rough ? ` Core covers ${pr.nwioiCeus} of the ${b.education} education hours, so up to ${pr.gapBeforePrior} more may be needed if none of your prior training counts.` : ''}</p>
      ${review}${cta}</div>`;
  }

  const lead = pr.priorSavings
    ? `<p class="save-lead" data-testid="save-lead">Your prior training could save you about <strong>${esc(pr.priorSavings.display)}</strong> in additional coursework.</p>`
    : pr.counted > 0 ? `<p class="save-lead" data-testid="save-lead">About ${plural(pr.counted, 'hour')} of your prior training may count.</p>` : '<p class="save-lead" data-testid="save-lead">You may need the full remaining coursework beyond Core.</p>';
  const overlap = pr.overlap > 0
    ? `<p class="small muted" data-testid="prior-overlap">${plural(pr.overlap, 'hour')} you reported overlap${pr.overlap === 1 ? 's' : ''} with what Core already covers or go${pr.overlap === 1 ? 'es' : ''} beyond the requirement, so ${pr.overlap === 1 ? 'it isn’t' : 'they aren’t'} counted twice.</p>` : '';
  const split = pr.mappingKnown && pr.remaining > 0 ? ` <span class="small">(${pr.remainingCore} core knowledge, ${pr.remainingSkills} ${esc(trainingLower)})</span>` : '';
  const need = pr.remaining === 0
    ? '<p class="remaining" data-testid="prior-need">Your prior training may cover the rest of the education requirement. No additional coursework estimated.</p>'
    : `<p class="remaining" data-testid="prior-need">About <strong>${plural(pr.remaining, 'CEU')}</strong> remaining${split}${roughChip}</p>`;

  let cost = '';
  if (pr.remaining > 0) {
    cost = `
      <div class="grid2 additional">
        <div class="field"><label for="add-nwioi">CEUs you’d take with NWIOI</label>
          <input type="number" id="add-nwioi" data-add="nwioiCeus" min="0" max="${pr.remaining}" step="1" inputmode="numeric" value="${pr.nwioiAdditionalCeus}"></div>
        ${pr.outsideCeus > 0 ? `<div class="field"><label for="add-outside">Expected cost of your other ${plural(pr.outsideCeus, 'CEU')} (optional)</label>
          <input type="number" id="add-outside" data-add="outsideCost" min="0" step="1" inputmode="decimal" value="${pr.outsideCost ?? ''}" placeholder="$">
          <span class="small muted">Other providers set their own prices.</span></div>` : ''}
      </div>`;
  }
  const table = `<table class="math combined-table" data-testid="combined-table"><tbody>
      <tr><td>NWIOI tuition · Core Program</td><td class="amt">${esc(core.price.display || '—')}</td></tr>
      ${pr.nwioiAdditionalCeus > 0 ? `<tr><td>Additional NWIOI coursework · ${plural(pr.nwioiAdditionalCeus, 'CEU')}</td><td class="amt" data-testid="additional-cost">${esc(pr.additional?.display || 'Confirm with admissions')}</td></tr>` : ''}
      ${pr.outsideCeus > 0 ? `<tr><td>Coursework with other institutes · ${plural(pr.outsideCeus, 'CEU')}</td><td class="amt">${pr.outsideCost !== null ? esc('$' + Math.round(pr.outsideCost).toLocaleString('en-US')) : '<span class="muted">Not included</span>'}</td></tr>` : ''}
      ${pr.combined ? `<tr class="total"><td>Estimated combined cost${pr.combined.complete ? '' : ' <span class="small muted">(without other institutes)</span>'}</td><td class="amt" data-testid="combined-cost">${esc(pr.combined.display)}</td></tr>` : ''}
    </tbody></table>`;

  return `<div data-testid="prior-summary">
    ${lead}
    ${need}
    ${cost}
    ${table}
    ${pr.combined ? `<p class="planning small" data-testid="planning">${esc(PLANNING_COPY)}</p>` : ''}
    ${cta}
    ${det('prior-breakdown', 'How we worked this out', `<ol class="steps small">
      <li><strong>What you may already have covered:</strong> about ${plural(pr.counted, 'hour')} of your prior training may count toward the rest of the education requirement.</li>
      <li><strong>What NWIOI includes:</strong> <span data-testid="prior-includes">${pr.nwioiCeus} CEUs of NWIOI coursework, plus supervision and SAR.</span></li>
      <li><strong>What you may still need:</strong> ${pr.remaining === 0 ? 'nothing more is estimated.' : `about ${plural(pr.remaining, 'CEU')}.`}</li>
    </ol>${review}`, 'prior-how')}
    ${overlap}
  </div>`;
}

// ------------------------------------------------------------------ À La Carte builder
function alaFlow(p) {
  const b = p.benchmarks;
  return `
  <section class="card flow" id="ala-flow" aria-labelledby="ala-h">
    <h2 id="ala-h">Build your À La Carte estimate</h2>
    <p class="small">Choose individual courses, supervision, or SAR. Your estimate updates as you go.</p>
    ${radioGroup('where', 'Where would you like to do your supervision?', [['nwioi', 'With NWIOI'], ['outside', 'With an outside supervisor'], ['help', 'Help me decide']], state.where)}
    ${state.where === 'outside' ? '<p class="small muted">You’ll pay your outside supervisor separately.</p>' : hoursQuestion('supervision', 'Supervision completed toward this credential', `Up to ${b.supervision} hours with an ${esc(p.terms.supervisorTitle)}.`, b.supervision, 'standard target')}
    ${radioGroup('sar', 'Have you completed a Sexuality Attitude Reassessment (SAR)?', [['yes', 'Yes'], ['no', 'No'], ['unsure', 'I’m not sure']], state.sar)}
    <div id="ala-result" class="result-box" aria-live="polite">${result ? alaResult() : ''}</div>
  </section>`;
}

function alaResult() {
  const t = result.tracks.alaCarte;
  const s = t.selection, sug = t.suggestion, u = t.units;
  const num = (id, key, label, max, hint) => `<div class="field"><label for="${id}">${esc(label)}</label>
      <input type="number" id="${id}" data-ala="${key}" min="0" ${max ? `max="${max}"` : ''} step="1" inputmode="numeric" value="${s[key] ?? ''}" placeholder="Choose">
      <span class="small muted">${hint}</span></div>`;
  const eduHint = (v) => (v !== null ? `Suggested from your prior training: ${v}` : 'How many would you buy?');
  const p = t.price;
  return `
    <h3 class="small-h">What you’d buy from NWIOI</h3>
    <div class="grid2">
      ${num('ala-core', 'coreCeus', 'Core Knowledge CEUs', result.benchmarks.core, eduHint(sug.coreCeus))}
      ${num('ala-skills', 'skillsCeus', `${u.trainingLabel} CEUs`, result.benchmarks.skills, eduHint(sug.skillsCeus))}
    </div>
    ${t.outsideSupervision ? '' : `<div class="grid2">
      ${num('ala-ind', 'individualHours', 'Hours of individual supervision', null, 'One-to-one with an NWIOI supervisor')}
      ${num('ala-grp', 'groupSessions', 'Group supervision sessions', null, `${u.groupSessionHours} hours each`)}
    </div>`}
    ${t.sarOffer ? `<label class="small sar-offer" style="font-weight:400"><input type="checkbox" data-ala="sar" ${s.sar ? 'checked' : ''}> ${esc(t.sarOffer)}</label>` : ''}
    <div class="ala-total">
      <span class="small">Estimated cost with NWIOI</span>
      <strong data-testid="price-alaCarte">${esc(known(p) ? p.display : p.confirmText)}${known(p) && p.complete === false ? ' <span class="small muted">so far</span>' : ''}</strong>
      ${p.draft ? '<span class="chip warn">Draft pricing · preview only</span>' : ''}
    </div>
    ${t.basedOn ? `<p class="small muted" data-testid="based-on">${esc(t.basedOn)}</p>` : ''}
    ${t.items.length ? det('ala-included', 'See what’s included', itemList(t.items, 'ala-items'), 'ala-included') : ''}
    ${t.notes?.length ? `<ul class="small notes" data-testid="ala-notes">${t.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    ${result.recommended === 'alaCarte' ? `<p class="small" data-testid="reasons">${result.reasons.map(esc).join(' ')}</p>` : ''}
    <p class="planning small">${esc(PLANNING_COPY)}</p>
    <div class="cta">${linkHtml(t.cta.link, t.cta.label, 'btn primary', 'cta-alaCarte')} ${linkHtml(t.secondary.link, t.secondary.label, 'btn', 'ala-book')}</div>
    <p class="small muted">${esc(result.prior.libraryNote || '')}</p>`;
}

function flowSection() {
  if (!state.path || deciding() || !state.mode) return '';
  const p = pathCfg();
  const other = state.mode === 'prior'
    ? '<p class="small switch">Want to pick and choose instead? <button type="button" class="link" data-mode="ala">Build an À La Carte estimate</button></p>'
    : '<p class="small switch">Prefer a complete program? <button type="button" class="link" data-mode="prior">See what your prior training could save with Core</button></p>';
  return (state.mode === 'prior' ? priorFlow(p) : alaFlow(p)) + other;
}

// ------------------------------------------------------------------ live estimate bar
// Appears only once the option cards (which already show the price) scroll out of view.
let lastBarValue = null;
let cardsVisible = true;
function renderBar() {
  const active = state.path && !deciding() && result;
  $bar.classList.toggle('is-shown', Boolean(active) && !cardsVisible);
  $bar.setAttribute('aria-hidden', String(!(active && !cardsVisible)));
  if (!active) { $bar.innerHTML = ''; lastBarValue = null; return; }
  const ala = result.tracks.alaCarte, core = result.tracks.core;
  const useAla = state.mode === 'ala';
  const t = useAla ? ala : core;
  const label = useAla ? 'Estimated cost with NWIOI' : known(core.price) ? 'Standard NWIOI tuition' : 'Your NWIOI tuition';
  const value = known(t.price) ? t.price.display + (t.price.complete === false ? '+' : '') : t.price.confirmText;
  const parts = [];
  if (!useAla && core.price.payInFull) parts.push(`Pay in full: ${core.price.payInFull.display}`);
  const comb = result.prior?.combined;
  if (!useAla && comb && result.prior.remaining > 0) parts.push(`Estimated combined cost: ${comb.display}${comb.complete ? '' : '+'}`);
  if (useAla && !known(ala.price)) parts.push('Your estimate updates as you choose');
  const sub = parts.join(' · ') || 'Planning estimate';
  const name = useAla ? 'À La Carte' : 'Core Program';
  const changed = lastBarValue !== null && lastBarValue !== name + value + sub;
  lastBarValue = name + value + sub;
  $bar.innerHTML = `<div class="wrap estimate-inner">
      <div class="estimate-text" aria-live="polite" aria-atomic="true">
        <span class="estimate-label">${esc(label)} · <strong>${esc(name)}</strong>${t.price.draft ? ' <span class="chip draft-chip">Draft</span>' : ''}</span>
        <span class="estimate-value ${known(t.price) ? '' : 'confirm-value'}" data-testid="bar-price">${esc(value)}</span>
        <span class="estimate-sub" data-testid="bar-sub">${esc(sub)}</span>
      </div>
      <span class="bar-cta">${linkHtml(config.links.scheduling, 'Book a free admissions call', 'btn bar-btn', 'bar-book')}</span>
    </div>`;
  if (changed) {
    const el = $bar.querySelector('.estimate-value');
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }
}

// Show the bar once the option cards' price has scrolled away; hide it again only
// when the cards are back in view below where the bar sits (hysteresis, so small
// scrolls near the cards don't make it flicker on and off).
let ticking = false;
function updateBarVisibility() {
  ticking = false;
  const grid = $main.querySelector('.opt-grid');
  let next = cardsVisible;
  if (!grid) next = true;
  else {
    const r = grid.getBoundingClientRect();
    const barH = $bar.offsetHeight || 90;
    if (cardsVisible && r.bottom < barH + 20) next = false; // cards have scrolled up behind where the bar sits
    else if (!cardsVisible && r.top > barH) next = true; // cards fully back in view
  }
  if (next !== cardsVisible) { cardsVisible = next; renderBar(); }
}
function watchCards() {
  const grid = $main.querySelector('.opt-grid');
  if (grid) { const r = grid.getBoundingClientRect(); if (r.bottom < ($bar.offsetHeight || 90) + 20) cardsVisible = false; else if (r.top > ($bar.offsetHeight || 90)) cardsVisible = true; }
  renderBar();
}
const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(updateBarVisibility); } };
window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', onScroll);

// ------------------------------------------------------------------ rendering
function withFocus(fn) {
  const id = document.activeElement?.id;
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
    const opts = $main.querySelector('#options');
    if (opts) { opts.innerHTML = optionsSection(); }
    const pr = $main.querySelector('#prior-result');
    if (pr && result) pr.innerHTML = priorResult();
    const ar = $main.querySelector('#ala-result');
    if (ar && result) ar.innerHTML = alaResult();
    for (const sel of ['[data-testid="combined-cost"]', '[data-testid="save-lead"] strong', '[data-testid="price-alaCarte"]', '[data-testid="ala-card-price"]']) flashChanged(sel);
  });
  watchCards();
}

function render() {
  $main.innerHTML = `
  <section class="intro hero">
    <h1>See what your prior training could save you.</h1>
    <p class="lede">Graduate coursework and continuing education you’ve already completed may count toward your AASECT credential.</p>
    ${config.preview ? '<p class="notice warn small">Preview mode: draft prices and placeholder links are visible and labeled. The public sees only approved offers.</p>' : ''}
  </section>
  <section class="card picker">
    ${radioGroup('path', 'Which credential are you working toward?', [...config.paths.filter((x) => x.enabled).map((x) => [x.path, x.pathName]), ['deciding', 'I’m still deciding']], state.path)}
  </section>
  <div id="options">${optionsSection()}</div>
  <div id="flow">${flowSection()}</div>
  <p class="small muted footnote">NWIOI provides training. AASECT makes certification decisions.</p>`;
  $main.setAttribute('aria-busy', 'false');
  watchCards();
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
      const opts = $main.querySelector('#options');
      if (opts) opts.innerHTML = `<div class="card"><p>We couldn’t load tuition right now.</p><div class="cta">${linkHtml(config.links.scheduling, 'Book a free admissions call', 'btn primary big', 'primary-cta')}</div></div>`;
    }
  }, immediate ? 0 : 120);
}

function setHours(key, value) {
  const max = pathCfg().benchmarks[key];
  if (value === 'unsure' || value === null) state[key] = value;
  else state[key] = Math.max(0, Math.min(max, Math.round(Number(value))));
  if (key === 'core' || key === 'skills') { state.additional = freshAdditional(); state.alaCarte[key === 'core' ? 'coreCeus' : 'skillsCeus'] = null; }
  if (key === 'supervision') { state.alaCarte.individualHours = null; state.alaCarte.groupSessions = null; }
  syncQuestion(key);
  requestEstimate();
}

function openMode(mode) {
  state.mode = mode;
  if (mode === 'ala') state.alaStarted = true;
  save();
  const flow = $main.querySelector('#flow');
  flow.innerHTML = flowSection();
  renderResult();
  requestEstimate(true);
  const sec = flow.querySelector('.flow');
  sec?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  sec?.querySelector('input')?.focus({ preventScroll: true });
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
    $main.querySelector('#flow').innerHTML = flowSection();
    window.scrollTo(0, scrollY);
    $main.querySelector(`input[name="${t.name}"][value="${t.value}"]`)?.focus();
    requestEstimate(true);
  } else if (t.dataset.num && t.value === '') setHours(t.dataset.num, null);
  else if (t.dataset.ala === 'sar') { state.alaCarte.sar = t.checked; requestEstimate(true); }
});

$main.addEventListener('toggle', (ev) => {
  if (ev.target.matches?.('details.expand, details.compare')) openState[ev.target.id] = ev.target.open;
}, true);

$main.addEventListener('click', (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.dataset.mode) openMode(t.dataset.mode);
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
    render();
    if (state.path) requestEstimate(true);
  } catch {
    $main.innerHTML = '<div class="card"><p>The track finder could not load. Please try again later.</p></div>';
  }
})();
