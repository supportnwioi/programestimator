# NWIOI Program Cost Estimator: proof of concept

This tool gives prospective students a preliminary NWIOI price range, based on the AASECT education, supervision, and SAR they still appear to need. It credits graduate and postgraduate coursework, CE, supervision, and SAR the student has already completed. NWIOI admissions confirms the final price.

## Run it

```bash
npm install
npm start                       # http://localhost:3000   admin: http://localhost:3000/admin
```

| Environment variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Turns on AI document review (Claude, `claude-opus-5-5`, with structured output). Without it, a clearly labeled **offline demo extractor** is used. The estimator works fully without uploads. |
| `NWIOI_ADMIN_PASSWORD` | Admin password. The default is `nwioi-demo-admin` for the proof of concept only. |
| `NWIOI_DATA_DIR` | Where settings, rulesets, estimates, and shares are stored. Default: `./data`. |
| `PORT` | Default `3000`. |

### Deploy on Cloudflare (Workers + Containers)

The Node server runs in a [Cloudflare Container](https://developers.cloudflare.com/containers/). A small Worker (`worker/index.js`) receives every request and forwards it to one container instance. The Worker is named `programestimator` in `wrangler.jsonc`, and the image comes from the `Dockerfile`. Containers require the Workers Paid plan.

1. Set the admin password as a secret: run `npx wrangler secret put NWIOI_ADMIN_PASSWORD`, or add it in the dashboard under the Worker's **Settings → Variables and Secrets**. If no secret is set, the server picks a random password and prints it to the container logs. You can also set `ANTHROPIC_API_KEY` to turn on AI document review.
2. Deploy, using either method:
   - **From the dashboard:** connect this repository to the Worker under **Settings → Builds**, with deploy command `npx wrangler deploy`. Each push to the production branch then builds and deploys.
   - **From a computer with Docker running:** run `npm install`, then `npx wrangler deploy`.
3. The first deploy takes several minutes while Cloudflare provisions the container. Until then, the Worker returns "starting up".

The container's disk is ephemeral, and it sleeps after 30 minutes of inactivity. When it sleeps or is redeployed, admin settings, estimates and shares reset. That is fine for testing. For production, move storage to D1/R2.

Behind an HTTP proxy, set `NODE_USE_ENV_PROXY=1` so that **Check AASECT for published changes** can reach aasect.org.

```bash
npm test                        # engine, extraction, and ruleset-lifecycle unit tests
node --test test/e2e.test.js    # full browser flow for all three paths (Playwright/Chromium)
```

`samples/` holds test documents: a syllabus PDF with one topic whose hours aren't stated, a transcript PDF, a CE certificate, a SAR certificate, and a supervision log.

## How it is built

| Piece | File |
|---|---|
| AASECT rules, as structured config (one file per path, with source URL, version, content hash, and review date) | `config/rulesets/*.json` |
| Snapshot of each official page's text when it was verified (used for change diffs) | `config/source-snapshots/*.txt` |
| Rules engine: totals, per-area minimums and caps, synchronous and sexuality-specific minimums, couples-counseling rule, supervision rules, SAR | `src/engine.js` |
| Private price calculation and public estimate (range and checklist) | `src/estimate.js` |
| Document review: Claude when configured, offline extractor otherwise | `src/extract.js` |
| Change detection, draft, validation, approval | `src/rulesetAdmin.js`, `src/sourceText.js` |
| Duplicate detection, shared by the browser and the server | `public/shared/dedupe.js` |
| Student UI / admin UI / privacy placeholder | `public/index.html` + `app.js`, `public/admin.html` + `admin.js`, `public/privacy.html` |

AI is used only to summarize documents, extract course details and **explicitly stated** hours, and suggest areas. If the model returns hours that the document doesn't state, they are discarded and the student gets a follow-up question. All counting and pricing is done in application code.

## AASECT requirements used (verified 2026-11-19)

Each path was checked against its official page, and each page shows a requirements version:

| Path | Version | Source |
|---|---|---|
| Sex Therapist | 2026.T.1 | https://www.aasect.org/aasect-requirements-sex-therapist-certification |
| Sexuality Counselor | 2026.C.1 | https://www.aasect.org/sexuality-counselor-requirements |
| Sexuality Educator | 2026.E.1 | https://www.aasect.org/certification/aasect-requirements-sexuality-educator-certification |

The same core knowledge rules apply to all three paths: 90 hours, at least 15 of them synchronous, at least 3 hours in each of the 17 Core Knowledge Areas, and no more than 20 hours counted in any one area. The other requirements differ by path:

| Requirement | Sex Therapist | Sexuality Counselor | Sexuality Educator |
|---|---|---|---|
| Skills training | 60 h (30 synchronous), 6 content areas, min 3 h / max 20 h each, plus a 16-hour couples counseling rule | 60 h (30 synchronous, 30 specific to sexuality counseling), 6 areas | 60 h (30 synchronous, 30 specific to sexuality education), 5 areas |
| SAR | 14 h, AASECT sponsored or approved | 14 h | 14 h |
| Supervision | 50 h (at least 25 individual), over 18 months; 25 h for applicants with 10+ years of experience | 30 h (group no more than 50%), over 12 months | 25 h (at least 5 individual, up to 20 group), over 9 months |

Credit conversion: 1 semester credit = 15 clock hours. Non-AASECT CE counts at half value.

## Counting decisions to confirm with NWIOI

- **One hour, counted once.** An additional hour can close an area shortfall, the overall gap, the synchronous gap, and the sexuality-specific gap at the same time. So the hours needed are the **largest** of those gaps, not their sum.
- **Area caps.** Hours above the 20-hour cap don't count toward the total. Within a capped area, the engine keeps the hours that also meet other minimums (couples, synchronous, sexuality-specific) first.
- **Not counted until confirmed.** These are left out of the price and listed for admissions review:
  - topic hours the student marks "not sure", or never answers;
  - hours not assigned to an area;
  - supervision not confirmed as being with an AASECT certified supervisor under contract;
  - training with no academic credit or CE;
  - a SAR or eligibility answer marked "not sure".
- **Uncertain credit type.** When the credit type is unknown, hours count at the non-AASECT (half) value.
- **Quarter credits.** AASECT publishes no quarter-credit conversion, so these are flagged for admissions.
- **Assumption about NWIOI's offerings.** The engine assumes NWIOI can provide synchronous, sexuality-specific education. If NWIOI doesn't offer a requirement for a path, it is shown as "outside NWIOI" and not priced. This is set per path under Admin → Pricing.
- **Not modeled.** The primary-supervisor sub-minimum and the optional 5 extra supervision hours that can count toward training are shown only as notes.
- **Outside NWIOI.** These are flagged from the intake answers and never priced:
  - degree and license;
  - clinical or professional hours;
  - AASECT membership;
  - application materials.

## Admin

- **Pricing & links:** education rate per CE hour, supervision rate per hour, SAR price, range buffer, scheduling URL, contact link, and which requirements NWIOI provides per path. The sample rates are $35 and $185. The **$650 SAR price is a placeholder**, so set the real one. Every estimate records the ruleset version and the pricing used.
- **Requirements rulesets:** **Check AASECT for published changes** fetches each source, then compares the content hash and version label and shows a line diff. From there, an admin can create a draft, edit its JSON (it's validated), and approve it. Approval requires confirming the draft was checked against the official source. Only approved rulesets affect new estimates. A path can be offered to students only when its ruleset is verified and approved.
- **Shared with admissions:** the student's contact details, intake entries, document source details, and any corrections they made. Uploaded files appear only if the student gave separate permission.
- **Estimates:** the itemized internal calculation. This is never shown to students.

## Privacy behavior in this proof of concept

- **Uploads:** files are processed in memory and not stored.
- **Sharing:** documents are saved only when a student shares their estimate and also checks the separate document box.
- **Booking:** students can book an admissions call without sharing anything.
- **Policy page:** `/privacy` is a placeholder. The privacy policy and retention decisions are for a later phase.

## Before production

- Replace the file storage, the in-memory admin sessions, and the shared admin password with a real database and real authentication.
- Set real scheduling and contact links and a real SAR price.
- Have NWIOI sign off on the three initial rulesets. They are marked "pending NWIOI sign-off".
- Run the AI document review with a real API key against a sample of real transcripts and syllabi.
