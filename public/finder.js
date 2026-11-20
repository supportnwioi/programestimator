// Track finder: credential → a few answers → one recommended NWIOI tier with
// tuition (or a Modular estimate), what's included, and one next step.
// All pricing comes from POST /api/track-estimate (server-side catalog).
const $main = document.getElementById('finder');
const $bar = document.getElementById('price-bar');
const $headerBook = document.getElementById('header-book');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let config = null;
let result = null;
const fresh = () => ({ path: null, education: null, supervision: null, sar: null, where: null, coreSar: null, modular: { ceus: null, sar: null, individualHours: null, groupSessions: null } });
let state = fresh();

const deciding = () => state.path === 'deciding';
const pathCfg = () => config.paths.find((p) => p.path === state.path);
function load() { try { const s = JSON.parse(sessionStorage.getItem('nwioi-finder')); if (s) state = { ...fresh(), ...s, modular: { ...fresh().modular, ...(s.modular || {}) } }; } catch { /* storage unavailable */ } }
function save() { try { sessionStorage.setItem('nwioi-finder', JSON.stringify(state)); } catch { /* storage unavailable */ } }

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

const radioGroup = (name, legend, options, value, hint = '') => `
  <fieldset><legend>${esc(legend)}</legend>${hint}
    <div class="seg">${options.map(([k, l]) => `<label><input type="radio" name="${name}" value="${k}" ${value === k ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>
  </fieldset>`;

function questions(p) {
  const b = p.benchmarks;
  return `
  <section class="card">
    ${hoursQuestion('education', 'How many hours of relevant education have you completed?',
      `A rough estimate of graduate coursework, training, and continuing education that might apply. The ${esc(p.pathName)} credential calls for ${b.education} hours.`,
      b.education, 'education benchmark')}
    <details class="credits">
      <summary>My coursework is listed in credits</summary>
      <p class="small">AASECT counts one college or university semester credit as ${b.semesterCreditClockHours} hours (a 3-credit semester course = ${3 * b.semesterCreditClockHours} hours). Continuing education from bodies other than AASECT counts at ${b.nonAasectCeMultiplier === 0.5 ? 'half' : `${b.nonAasectCeMultiplier}×`} value. Quarter credits have no published conversion, so admissions will review those with you.</p>
      <div class="row">
        <label class="small" for="credits-in" style="margin:0">Semester credits</label>
        <input type="number" id="credits-in" min="0" step="0.5" inputmode="decimal" style="max-width:110px">
        <span class="small" id="credits-out" aria-live="polite"></span>
        <button type="button" data-add-credits>Add to my education hours</button>
      </div>
      <p class="small muted">Count each course once. If it’s already in your hours above, don’t add it again.</p>
    </details>
  </section>
  <section class="card">
    ${hoursQuestion('supervision', 'How many supervision hours have you completed toward this credential?',
      `Supervision with an ${esc(p.terms.supervisorTitle)}. The standard target for this credential is ${b.supervision} hours.`,
      b.supervision, 'standard target')}
  </section>
  <section class="card">
    ${radioGroup('sar', 'Have you completed a general Sexuality Attitude Reassessment (SAR)?', [['yes', 'Yes'], ['no', 'No'], ['unsure', 'I’m not sure']], state.sar,
      state.sar === 'yes' ? '' : '')}
    ${state.sar === 'yes' ? '<p class="small muted">Thanks, we’ll note it as self-reported. Admissions can confirm whether your SAR meets the requirement.</p>' : ''}
  </section>
  <section class="card">
    ${radioGroup('where', 'Where would you like to do your supervision?', [['nwioi', 'With NWIOI'], ['outside', 'With an outside supervisor'], ['help', 'Help me decide']], state.where)}
  </section>`;
}

// ------------------------------------------------------------------ result
function priceBlock(t, { big = false } = {}) {
  const p = t.price;
  if (p.amount === null || p.amount === undefined) {
    return `<p class="${big ? 'range personal' : 'price-sm'}" data-testid="${big ? 'rec-price' : `price-${t.key}`}">${esc(p.confirmText)}</p>`;
  }
  const partial = p.complete === false ? ' <span class="small muted">so far</span>' : '';
  return `<p class="price-label-sm small muted">${esc(p.label)}${p.fixed ? ' · fixed package price' : ''}</p>
    <p class="${big ? 'range' : 'price-sm'}" data-testid="${big ? 'rec-price' : `price-${t.key}`}">${esc(p.display)}${partial}</p>
    ${p.draft ? '<p><span class="chip warn">Draft tuition · preview only, pending NWIOI approval</span></p>' : ''}
    ${t.paymentPlans?.length ? `<ul class="small plans">${t.paymentPlans.map((x) => `<li>or ${esc(x.text)}${x.draft ? ' <span class="chip warn">draft</span>' : ''}</li>`).join('')}</ul>` : ''}`;
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

function modularControls(t) {
  const s = t.selection, r = t.rates;
  const sug = t.suggestion;
  return `
  <div class="modular-controls" aria-label="What you plan to buy from NWIOI">
    <div class="field"><label for="mod-ceus">CEUs you plan to buy from NWIOI</label>
      <input type="number" id="mod-ceus" data-mod="ceus" min="0" max="${result.benchmarks.education}" step="1" inputmode="numeric" value="${s.ceus ?? ''}" placeholder="Choose">
      <span class="small muted">${sug.ceus !== null ? `Suggested from your answers: ${sug.ceus}` : 'Choose a number, or review it with admissions.'}${r.ceu ? ` · ${esc(r.ceu)} per CEU` : ''}</span></div>
    <label class="small" style="font-weight:400"><input type="checkbox" data-mod="sar" ${s.sar ? 'checked' : ''}> Add a SAR${r.sar ? ` (${esc(r.sar)})` : ''}</label>
    ${t.outsideSupervision ? '' : `<div class="grid2">
      <div class="field"><label for="mod-ind">Individual supervision hours</label>
        <input type="number" id="mod-ind" data-mod="individualHours" min="0" step="1" inputmode="numeric" value="${s.individualHours ?? ''}" placeholder="Choose">
        <span class="small muted">${r.individual ? `${esc(r.individual)} per hour` : 'Rate to be confirmed'}</span></div>
      <div class="field"><label for="mod-grp">Group supervision sessions</label>
        <input type="number" id="mod-grp" data-mod="groupSessions" min="0" step="1" inputmode="numeric" value="${s.groupSessions ?? ''}" placeholder="Choose">
        <span class="small muted">${r.groupSession ? `${esc(r.groupSession)} per ${r.groupSessionHours}-hour session` : 'Rate to be confirmed'}</span></div>
    </div>`}
    ${t.lines.length ? `<ul class="small lines">${t.lines.map((l) => `<li><span>${esc(l.label)}</span><span>$${l.amount.toLocaleString('en-US')}</span></li>`).join('')}</ul>` : ''}
  </div>`;
}

function trackCard(t, recommendedKey) {
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
    ${t.key === 'core' && t.price.amount !== null && t.price.sarOffered ? `<label class="small" style="font-weight:400"><input type="checkbox" data-core-sar ${t.price.sarIncluded ? 'checked' : ''}> Include SAR (${esc(t.price.sarAddOn)})</label><p class="small muted">${esc(t.price.base)} base tuition${t.price.sarIncluded ? ` + ${esc(t.price.sarAddOn)} SAR` : ''}</p>` : ''}
    ${t.key === 'modular' ? modularControls(t) : ''}
    ${t.notes?.length ? `<ul class="small notes">${t.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <ul class="small included">${t.included.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    ${t.note ? `<p class="small">${esc(t.note)}</p>` : ''}
    ${ctaHtml(t, false)}
  </article>`;
}

function resultPanel() {
  if (!state.path) return `<h2 class="price-label">Your NWIOI track</h2><p class="muted">Choose the credential you’re working toward to see your recommended track and NWIOI tuition.</p>`;
  if (deciding()) {
    return `<h2 class="price-label">Not sure which credential fits?</h2>
      <p>Sex therapist, sexuality counselor and sexuality educator credentials have different training and supervision requirements. In a free admissions call, we’ll talk about your background and goals, explain how each credential works, and help you choose a direction.</p>
      <div class="cta">${linkHtml(config.links.scheduling, 'Talk through my options', 'btn primary big', 'primary-cta')}</div>`;
  }
  if (!result) return `<h2 class="price-label">Your NWIOI track</h2><p class="muted">Loading…</p>`;
  const t = result.tracks[result.recommended];
  return `<p class="small muted">Recommended track for the ${esc(result.pathName)} credential</p>
    <h2 class="rec-name" data-testid="rec-name">${esc(t.name)}</h2>
    ${t.lead ? `<p class="lead">${esc(t.lead)}</p>` : ''}
    <div aria-live="polite" aria-atomic="true">${priceBlock(t, { big: true })}</div>
    ${t.key === 'core' && t.price.amount !== null ? `<p class="small muted">${esc(t.price.base)} Core tuition${t.price.sarIncluded ? ` + ${esc(t.price.sarAddOn)} SAR` : ''}</p>` : ''}
    <h3 class="small-h">Why it fits</h3>
    <ul class="small reasons" data-testid="reasons">${result.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
    ${result.notes.length ? `<ul class="small notes">${result.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    <h3 class="small-h">What’s included</h3>
    <ul class="small included">${t.included.slice(0, 5).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    ${t.key === 'core' ? `<p class="small">${esc(t.note)}</p>` : ''}
    ${ctaHtml(t, true)}
    ${t.key === 'modular' ? '<p class="small"><a href="#compare">Adjust what you’d buy</a></p>' : ''}`;
}

function compareSection() {
  if (!result || deciding()) return '';
  const { comprehensive, core, modular } = result.tracks;
  return `<section id="compare" class="compare" aria-labelledby="compare-h">
    <h2 id="compare-h">Compare ${core ? 'all three tracks' : 'tracks'} for the ${esc(result.pathName)} credential</h2>
    <p class="small muted">Comprehensive and Core are fixed package prices. Your answers change which track we recommend and the Modular estimate, not the package tuition.</p>
    <div class="track-grid">${trackCard(comprehensive, result.recommended)}${trackCard(core, result.recommended)}${trackCard(modular, result.recommended)}</div>
  </section>`;
}

function renderBar() {
  const show = Boolean(state.path && !deciding() && result);
  $bar.hidden = !show;
  $bar.setAttribute('aria-hidden', String(!show));
  if (!show) { $bar.innerHTML = ''; return; }
  const t = result.tracks[result.recommended];
  const price = t.price.amount !== null && t.price.amount !== undefined ? t.price.display : t.price.confirmText;
  $bar.innerHTML = `<div><span class="small muted">${esc(t.name)}</span><strong>${esc(price)}</strong></div>${linkHtml(config.links.scheduling, 'Book a call', 'btn primary')}`;
}

// Re-render result areas while keeping focus/caret in a control the visitor is using.
function withFocus(fn) {
  const a = document.activeElement;
  const id = a?.id, pos = a && 'selectionStart' in a ? (() => { try { return a.selectionStart; } catch { return null; } })() : null;
  fn();
  if (id) {
    const el = document.getElementById(id);
    if (el && el !== document.activeElement) { el.focus(); if (pos !== null) try { el.setSelectionRange(pos, pos); } catch { /* number inputs */ } }
  }
}
function renderResult() {
  withFocus(() => {
    const aside = $main.querySelector('.quick-price');
    if (aside) aside.innerHTML = resultPanel();
    const cmp = $main.querySelector('#compare-wrap');
    if (cmp) cmp.innerHTML = compareSection();
  });
  renderBar();
}

function render() {
  $headerBook.innerHTML = linkHtml(config.links.scheduling, 'Book a free admissions call', 'btn small-btn', 'header-book');
  const p = state.path && !deciding() ? pathCfg() : null;
  $main.innerHTML = `
  <section class="intro">
    <h1>Find the right NWIOI track for you</h1>
    <p>Answer a few quick questions. We’ll suggest the NWIOI track that fits where you are, and show NWIOI tuition and what’s included.</p>
    <p class="small muted">Your credential (set by AASECT) determines the training you need. Your NWIOI tier determines what you buy from NWIOI.</p>
    ${config.preview ? '<p class="notice warn small">Preview mode: draft tuition and placeholder links are visible and labeled. The public sees only approved offers.</p>' : ''}
  </section>
  <div class="quick-grid">
    <div class="quick-inputs">
      <section class="card">
        ${radioGroup('path', 'Which credential are you working toward?', [...config.paths.filter((x) => x.enabled).map((x) => [x.path, x.pathName]), ['deciding', 'I’m still deciding']], state.path)}
      </section>
      ${p ? questions(p) : ''}
    </div>
    <aside class="quick-price card" aria-label="Your recommended NWIOI track">${resultPanel()}</aside>
  </div>
  <div id="compare-wrap">${compareSection()}</div>`;
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
        body: JSON.stringify({ path: state.path, education: state.education, supervision: state.supervision, sar: state.sar, supervisionWhere: state.where, coreSar: state.coreSar, modular: state.modular }),
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
  if (key === 'education') state.modular.ceus = null;
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
    if (prev !== t.value) { state.modular = fresh().modular; state.coreSar = null; }
    if (!deciding()) for (const k of ['education', 'supervision']) if (typeof state[k] === 'number') state[k] = Math.min(state[k], pathCfg().benchmarks[k]);
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
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.dataset.zero) setHours(t.dataset.zero, 0);
  else if (t.dataset.unsure) setHours(t.dataset.unsure, state[t.dataset.unsure] === 'unsure' ? null : 'unsure');
  else if ('addCredits' in t.dataset) {
    const c = Number($main.querySelector('#credits-in').value);
    if (!(c > 0)) return;
    const add = c * pathCfg().benchmarks.semesterCreditClockHours;
    setHours('education', (typeof state.education === 'number' ? state.education : 0) + add);
    $main.querySelector('#credits-in').value = '';
    $main.querySelector('#credits-out').textContent = `Added ${add} hours.`;
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
