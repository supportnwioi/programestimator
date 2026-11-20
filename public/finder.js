// Track finder: credential → a few answers → one recommended NWIOI tier with
// standard tuition (or a Modular estimate), what's included, and one next step.
// All pricing comes from POST /api/track-estimate (server-side catalog).
const $main = document.getElementById('finder');
const $bar = document.getElementById('price-bar');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PLANNING_COPY = 'This is a planning estimate. You and NWIOI admissions will review your prior training, the track that fits your goals, and any scholarship or equity options. We’ll confirm your final NWIOI cost together before you enroll.';

let config = null;
let result = null;
const freshModular = () => ({ coreCeus: null, skillsCeus: null, sar: null, individualHours: null, groupSessions: null });
const fresh = () => ({ path: null, core: null, skills: null, supervision: null, sar: null, where: null, coreSar: null, modular: freshModular() });
let state = fresh();

const deciding = () => state.path === 'deciding';
const pathCfg = () => config.paths.find((p) => p.path === state.path);
function load() { try { const s = JSON.parse(sessionStorage.getItem('nwioi-finder-v2')); if (s) state = { ...fresh(), ...s, modular: { ...freshModular(), ...(s.modular || {}) } }; } catch { /* storage unavailable */ } }
function save() { try { sessionStorage.setItem('nwioi-finder-v2', JSON.stringify(state)); } catch { /* storage unavailable */ } }

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

function questions(p) {
  const b = p.benchmarks;
  const ex = config.examples || {};
  return `
  <section class="card">
    <h2 class="q-group">Education you’ve completed</h2>
    <p class="small muted">Rough estimates of graduate coursework, training, and continuing education that might apply. The ${esc(p.pathName)} credential calls for ${b.core} core knowledge hours and ${b.skills} skills training hours. Extra hours in one category don’t count toward the other.</p>
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
    ${hoursQuestion('supervision', 'Supervision completed toward this credential',
      `Up to ${b.supervision} hours with an ${esc(p.terms.supervisorTitle)}.`,
      b.supervision, 'standard target')}
  </section>
  <section class="card">
    ${radioGroup('sar', 'Have you completed a Sexuality Attitude Reassessment (SAR)?', [['yes', 'Yes'], ['no', 'No'], ['unsure', 'I’m not sure']], state.sar)}
    ${state.sar === 'yes' ? '<p class="small muted">Thanks. Admissions can confirm whether a previously completed SAR meets the requirement.</p>' : ''}
  </section>
  <section class="card">
    ${radioGroup('where', 'Where would you like to do your supervision?', [['nwioi', 'With NWIOI'], ['outside', 'With an outside supervisor'], ['help', 'Help me decide']], state.where)}
  </section>`;
}

// ------------------------------------------------------------------ result
function priceBlock(t, { big = false } = {}) {
  const p = t.price;
  const id = big ? 'rec-price' : `price-${t.key}`;
  if (p.amount === null || p.amount === undefined) {
    return `<p class="${big ? 'range personal' : 'price-sm'}" data-testid="${id}">${esc(p.confirmText)}</p>`;
  }
  const partial = p.complete === false ? ' <span class="small muted">so far</span>' : '';
  const pif = p.payInFull
    ? `<p class="pif" data-testid="${big ? 'rec-pif' : `pif-${t.key}`}"><strong>Pay in full · Save ${p.payInFull.percent}%:</strong> ${esc(p.payInFull.display)} <span class="small muted">(you save ${esc(p.payInFull.savings)})</span>${p.payInFull.draft ? ' <span class="chip warn">draft</span>' : ''}</p>`
    : '';
  return `<p class="price-label-sm small muted">${esc(p.label)}${p.rounded ? ' · rounded to the nearest $50' : ''}</p>
    <p class="${big ? 'range' : 'price-sm'}" data-testid="${id}">${esc(p.display)}${partial}</p>
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
    <div class="row">${linkHtml(s.application, 'View scholarship application', 'btn', 'scholarship-apply')} ${linkHtml(s.equity, 'Ask about equity rates', 'small', 'equity')}</div>
  </details>`;
}

function ctaHtml(t, primary) {
  const cls = primary ? 'btn primary big' : 'btn';
  const id = primary ? 'primary-cta' : `cta-${t.key}`;
  const label = t.cta.viaAdmissions && t.key === 'comprehensive' ? 'Explore enrollment with admissions' : t.cta.label;
  let html = linkHtml(t.cta.link, label, cls, id);
  if (t.secondary) html += ` ${linkHtml(t.secondary.link, t.secondary.label, primary ? 'btn' : 'small', primary ? 'secondary-cta' : '')}`;
  for (const x of t.extraLinks || []) html += ` ${linkHtml(x.link, x.label, 'small')}`;
  return `<div class="cta">${html}</div>`;
}

const mathRow = (t) => (l) => `<tr><td>${esc(l.label)}</td>${t.showRates ? `<td class="muted math-col">${l.math ? esc(l.math) : ''}</td><td class="amt">${esc(l.amount)}</td>` : ''}</tr>`;

function modularControls(t) {
  const s = t.selection, sug = t.suggestion, u = t.units;
  const num = (id, key, label, max, hint) => `<div class="field"><label for="${id}">${esc(label)}</label>
      <input type="number" id="${id}" data-mod="${key}" min="0" ${max ? `max="${max}"` : ''} step="1" inputmode="numeric" value="${s[key] ?? ''}" placeholder="Choose">
      <span class="small muted">${hint}</span></div>`;
  const sugText = (v, unsureMsg) => (v !== null ? `Suggested from your answers: ${v} remaining` : unsureMsg);
  return `
  <div class="modular-controls" aria-label="What you plan to buy from NWIOI">
    <p class="small"><strong>What you plan to buy from NWIOI</strong></p>
    <div class="grid2">
      ${num('mod-core', 'coreCeus', 'Core knowledge CEUs', result.benchmarks.core, sugText(sug.coreCeus, 'Needs review. Choose a number or ask admissions.'))}
      ${num('mod-skills', 'skillsCeus', `${u.trainingLabel} CEUs`, result.benchmarks.skills, sugText(sug.skillsCeus, 'Needs review. Choose a number or ask admissions.'))}
    </div>
    ${t.sarOffer ? `<label class="small" style="font-weight:400"><input type="checkbox" data-mod="sar" ${s.sar ? 'checked' : ''}> ${esc(t.sarOffer)}</label>` : ''}
    ${t.outsideSupervision ? '' : `<div class="grid2">
      ${num('mod-ind', 'individualHours', 'Individual supervision hours', null, 'One-to-one with an NWIOI supervisor')}
      ${num('mod-grp', 'groupSessions', 'Group supervision sessions', null, `${u.groupSessionHours} hours each`)}
    </div>`}
    ${t.lines.length ? `<table class="math small" data-testid="modular-math"><tbody>
      ${t.lines.filter((l) => l.group === 'education').map(mathRow(t)).join('')}
      ${t.educationSubtotal ? `<tr class="sub"><td>Education subtotal</td><td></td><td class="amt" data-testid="education-subtotal">${esc(t.educationSubtotal)}</td></tr>` : ''}
      ${t.lines.filter((l) => l.group !== 'education').map(mathRow(t)).join('')}
      ${t.price.amount !== null && t.price.amount !== undefined ? `<tr class="total"><td>Estimated cost with NWIOI</td>${t.showRates ? '<td></td>' : ''}<td class="amt">${esc(t.price.display)}${t.price.complete === false ? ' so far' : ''}</td></tr>` : ''}
    </tbody></table>` : ''}
  </div>`;
}

function coreSarToggle(t) {
  if (t.key !== 'core' || t.price.amount === null || !t.price.sarOffered) return '';
  return `<label class="small" style="font-weight:400"><input type="checkbox" data-core-sar ${t.price.sarIncluded ? 'checked' : ''}> Add SAR${t.price.sarAddOn ? ` for ${esc(t.price.sarAddOn)}` : ''}${state.sar === 'no' ? '' : ' if needed'}</label>`;
}

function trackCard(t, recommendedKey, controlsShownAbove) {
  if (!t) {
    return `<article class="track-card unavailable"><h3>${esc(result.tierNames.core)}</h3>
      <p class="small">${esc(result.coreNotDefinedNote)}</p>
      <div class="cta">${linkHtml(result.booking, 'Review my prior training', 'btn', 'cta-core')}</div></article>`;
  }
  const rec = t.key === recommendedKey;
  return `<article class="track-card ${rec ? 'is-recommended' : ''}" data-track="${t.key}">
    ${rec ? '<span class="chip ok">Recommended for you</span>' : ''}
    <h3>${esc(t.name)}</h3>
    ${priceBlock(t)}
    ${!(rec && controlsShownAbove) ? coreSarToggle(t) : ''}
    ${t.key === 'modular' && !(rec && controlsShownAbove) ? modularControls(t) : ''}
    ${t.notes?.length ? `<ul class="small notes">${t.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <ul class="small included">${t.included.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    ${t.note ? `<p class="small">${esc(t.note)}</p>` : ''}
    ${ctaHtml(t, false)}
  </article>`;
}

// Package prices are fixed, so show the number that does move with the answers:
// what buying only what's still needed (Modular) would cost.
function modularComparison(t) {
  if (!t.price.fixed) return '';
  const m = result.tracks.modular;
  const fixedNote = '<p class="small muted" data-testid="fixed-note">This package price is fixed: prior training doesn’t change it. Your answers change which track fits and what buying only what you need would cost.</p>';
  if (m.price.amount === null || m.price.amount === undefined) {
    return `${fixedNote}<div class="compare-live" data-testid="modular-live"><span class="small">Buying only what you still need (${esc(m.name)})</span><strong class="small">${esc(m.price.confirmText || 'Answer the hours questions to see this estimate')}</strong></div>`;
  }
  const value = m.price.complete === false ? `${m.price.display} so far` : m.price.display;
  return `${fixedNote}<div class="compare-live" data-testid="modular-live">
      <span class="small">Buying only what you still need (${esc(m.name)})</span>
      <strong data-testid="modular-live-price">${esc(value)}</strong>
      <a href="#compare" class="small" data-open-compare>See how this is calculated</a>
    </div>`;
}

function resultPanel() {
  if (!state.path) return `<h2 class="price-label">Your NWIOI track</h2><p class="muted">Choose the credential you’re working toward to see what’s included and what you’d pay NWIOI.</p>`;
  if (deciding()) {
    return `<h2 class="price-label">Not sure which credential fits?</h2>
      <p>Sex therapist, sexuality counselor and sexuality educator credentials have different training and supervision requirements. In a free admissions call, we’ll talk about your background and goals, explain how each credential works, and help you choose a direction.</p>
      <div class="cta">${linkHtml(config.links.scheduling, 'Talk through my options', 'btn primary big', 'primary-cta')}</div>
      <p class="small muted">NWIOI provides training. AASECT makes certification decisions.</p>`;
  }
  if (!result) return `<h2 class="price-label">Your NWIOI track</h2><p class="muted">Loading…</p>`;
  const key = result.startingPoint;
  const t = result.tracks[key];
  const heading = result.recommended
    ? `<span class="chip ok" data-testid="rec-chip">Recommended for you</span><p class="small muted" style="margin-top:6px">For the ${esc(result.pathName)} credential</p>`
    : `<p class="small muted">The complete program for the ${esc(result.pathName)} credential</p>`;
  return `${heading}
    <h2 class="rec-name" data-testid="rec-name">${esc(t.name)}</h2>
    ${t.lead ? `<p class="lead">${esc(t.lead)}</p>` : ''}
    <div aria-live="polite" aria-atomic="true">${priceBlock(t, { big: true })}</div>
    ${modularComparison(t)}
    <p class="planning small" data-testid="planning">${esc(PLANNING_COPY)}</p>
    ${coreSarToggle(t)}
    ${t.key === 'modular' ? modularControls(t) : ''}
    ${scholarshipBlock()}
    ${result.recommended ? `<h3 class="small-h">Why it fits</h3><ul class="small reasons" data-testid="reasons">${result.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    ${result.notes.length ? `<ul class="small notes" data-testid="notes">${result.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    ${t.notes?.length && t.key === 'modular' ? `<ul class="small notes">${t.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <h3 class="small-h">What’s included</h3>
    <ul class="small included">${t.included.slice(0, 6).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    ${t.key === 'core' ? `<p class="small">${esc(t.note)}</p>` : ''}
    ${ctaHtml(t, true)}
    <p class="small muted">NWIOI provides training. AASECT makes certification decisions.</p>`;
}

function compareSection(openNow) {
  if (!result || deciding()) return '';
  const { comprehensive, core, modular } = result.tracks;
  const shown = result.startingPoint;
  return `<details id="compare" class="compare" ${openNow ? 'open' : ''}>
    <summary><h2 id="compare-h">Compare tracks for the ${esc(result.pathName)} credential</h2></summary>
    <p class="small muted">Comprehensive and Core are fixed package prices. Your answers change which track fits and the Modular estimate, not the package tuition.</p>
    <div class="track-grid">${trackCard(comprehensive, result.recommended, shown === 'comprehensive')}${trackCard(core, result.recommended, shown === 'core')}${trackCard(modular, result.recommended, shown === 'modular')}</div>
  </details>`;
}

// The live number: pinned to the top of the screen, updates as answers change.
let lastBarValue = null;
function renderBar() {
  let label = 'Standard NWIOI tuition', name = '', value = '—', sub = 'Choose a credential to see your track and price', valueClass = 'muted-value', draft = false;
  if (deciding()) {
    label = 'Not sure which credential?'; value = 'Let’s talk'; sub = 'A free admissions call can help you choose'; valueClass = '';
  } else if (state.path && result) {
    const t = result.tracks[result.startingPoint];
    const known = t.price.amount !== null && t.price.amount !== undefined;
    name = t.name;
    label = known ? t.price.label : (result.recommended ? 'Recommended for you' : 'Complete program');
    value = known ? t.price.display + (t.price.complete === false ? '+' : '') : t.price.confirmText;
    valueClass = known ? '' : 'confirm-value';
    const m = result.tracks.modular;
    const modularAlt = t.price.fixed && m.price.amount !== null && m.price.amount !== undefined && m.price.complete !== false ? ` · Only what you need: ${m.price.display}` : '';
    sub = known && t.price.payInFull ? `Pay in full: ${t.price.payInFull.display}${modularAlt}` : known ? `Planning estimate${modularAlt}` : 'We’ll confirm your tuition';
    draft = Boolean(t.price.draft);
  } else if (state.path) sub = 'Updating…';
  const changed = lastBarValue !== null && lastBarValue !== name + value;
  lastBarValue = name + value;
  $bar.innerHTML = `<div class="wrap estimate-inner">
      <div class="estimate-text" aria-live="polite" aria-atomic="true">
        <span class="estimate-label">${esc(label)}${name ? ` · <strong>${esc(name)}</strong>` : ''}${draft ? ' <span class="chip draft-chip">Draft</span>' : ''}</span>
        <span class="estimate-value ${valueClass}" data-testid="bar-price">${esc(value)}</span>
        <span class="estimate-sub">${esc(sub)}</span>
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
let lastModularLive = null;
function renderResult() {
  withFocus(() => {
    const aside = $main.querySelector('.quick-price');
    if (aside) aside.innerHTML = resultPanel();
    const live = $main.querySelector('[data-testid="modular-live-price"]');
    if (live) {
      if (lastModularLive !== null && lastModularLive !== live.textContent) live.classList.add('flash');
      lastModularLive = live.textContent;
    }
    const cmp = $main.querySelector('#compare-wrap');
    const wasOpen = Boolean(cmp?.querySelector('#compare')?.open);
    if (cmp) cmp.innerHTML = compareSection(wasOpen);
  });
  renderBar();
}

function render() {
  const p = state.path && !deciding() ? pathCfg() : null;
  $main.innerHTML = `
  <section class="intro">
    <h1>Find the right NWIOI track for you</h1>
    <p>Answer a few quick questions. We’ll show which NWIOI track might fit, what’s included, and what you’d pay NWIOI.</p>
    <p class="small muted">Your credential (set by AASECT) determines the training you need. Your NWIOI tier determines what you buy from NWIOI.</p>
    ${config.preview ? '<p class="notice warn small">Preview mode: draft prices and placeholder links are visible and labeled. The public sees only approved offers.</p>' : ''}
  </section>
  <div class="quick-grid">
    <div class="quick-inputs">
      <section class="card">
        ${radioGroup('path', 'Which credential are you working toward?', [...config.paths.filter((x) => x.enabled).map((x) => [x.path, x.pathName]), ['deciding', 'I’m still deciding']], state.path)}
      </section>
      ${p ? questions(p) : ''}
    </div>
    <aside class="quick-price card" aria-label="Your NWIOI track and tuition">${resultPanel()}</aside>
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
        body: JSON.stringify({ path: state.path, core: state.core, skills: state.skills, supervision: state.supervision, sar: state.sar, supervisionWhere: state.where, coreSar: state.coreSar, modular: state.modular }),
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
  // Hours answers change the suggested Modular quantities; drop stale overrides.
  if (key === 'core') state.modular.coreCeus = null;
  if (key === 'skills') state.modular.skillsCeus = null;
  if (key === 'supervision') { state.modular.individualHours = null; state.modular.groupSessions = null; }
  syncQuestion(key);
  requestEstimate();
}

// ------------------------------------------------------------------ events
$main.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.dataset.range) setHours(t.dataset.range, t.value);
  else if (t.dataset.num) { if (t.value !== '') setHours(t.dataset.num, t.value); }
  else if (t.id === 'credits-in') {
    const c = Number(t.value);
    $main.querySelector('#credits-out').textContent = c > 0 ? `= ${c * pathCfg().benchmarks.semesterCreditClockHours} hours` : '';
  } else if (t.dataset.mod && t.type === 'number') {
    state.modular[t.dataset.mod] = t.value === '' ? null : Math.max(0, Math.round(Number(t.value)));
    requestEstimate();
  }
});

$main.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.name === 'path') {
    const prev = state.path;
    state.path = t.value;
    if (prev !== t.value) { state.modular = freshModular(); state.coreSar = null; }
    if (!deciding()) for (const k of ['core', 'skills', 'supervision']) if (typeof state[k] === 'number') state[k] = Math.min(state[k], pathCfg().benchmarks[k]);
    result = null;
    render();
    $main.querySelector(`input[name="path"][value="${t.value}"]`)?.focus();
    requestEstimate(true);
  } else if (t.name === 'sar' || t.name === 'where') {
    state[t.name] = t.value;
    if (t.name === 'sar') { state.modular.sar = null; state.coreSar = null; }
    if (t.name === 'where') { state.modular.individualHours = null; state.modular.groupSessions = null; }
    const scrollY = window.scrollY;
    render();
    window.scrollTo(0, scrollY);
    $main.querySelector(`input[name="${t.name}"][value="${t.value}"]`)?.focus();
    requestEstimate(true);
  } else if (t.dataset.num && t.value === '') setHours(t.dataset.num, null);
  else if (t.dataset.mod === 'sar') { state.modular.sar = t.checked; requestEstimate(true); }
  else if ('coreSar' in t.dataset) { state.coreSar = t.checked; requestEstimate(true); }
});

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
  if (t.dataset.zero) setHours(t.dataset.zero, 0);
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
