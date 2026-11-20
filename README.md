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
| Track finder (default page) | `public/index.html` + `finder.js`; logic in `src/tracks.js`; catalog in `config/tracks.json`; link safety in `src/links.js` |
| Detailed course-by-course estimator / admin UI / privacy placeholder | `public/detailed.html` + `detailed.js` (internal, admin sign-in, at `/detailed`), `public/admin.html` + `admin.js`, `public/privacy.html` |

AI is used only to summarize documents, extract course details and **explicitly stated** hours, and suggest areas. If the model returns hours that the document doesn't state, they are discarded and the student gets a follow-up question. All counting and pricing is done in application code.

## Track finder & tuition (default page)

Headline **“Build on the training you’ve already done.”** followed by one sentence on using coursework already completed. NWIOI offers two options per credential:

- **Core Program · Tier I:** 99 CEUs of NWIOI coursework, supervision for the credential, and SAR at a fixed tuition. SAR is always included, and tuition stays the same if the student has already completed one.
- **À La Carte · Tier II:** individual courses, NWIOI supervision and SAR, bought as needed.

| Credential | Core tuition | Supervision in Core |
|---|---:|---|
| Sex Therapist | $8,200 | 26 individual + 24 group hours |
| Sexuality Counselor | $7,450 | 15 individual + 15 group hours |
| Sexuality Educator | $6,950 | 5 individual + 20 group hours |

**Core payment options** (`paymentOptions` in `config/tracks.json`, shown with Core tuition):

| Credential | Core tuition | Pay in full (5% off) | 12 monthly (2% off) | 18 monthly (standard) | Equity Scholarship (5% off, up to 24 monthly) |
|---|---:|---:|---:|---:|---:|
| Sex Therapist | $8,200 | $7,790.00 | $8,036.00 ($669.67/mo) | $8,200.00 ($455.56/mo) | $7,790.00 ($324.58/mo) |
| Sexuality Counselor | $7,450 | $7,077.50 | $7,301.00 ($608.42/mo) | $7,450.00 ($413.89/mo) | $7,077.50 ($294.90/mo) |
| Sexuality Educator | $6,950 | $6,602.50 | $6,811.00 ($567.58/mo) | $6,950.00 ($386.11/mo) | $6,602.50 ($275.10/mo) |

Monthly amounts are rounded to the cent, and the final payment absorbs the rounding so the payments add up to the exact total. There are no installment fees, and the payment options apply to Core tuition only.

**Equity Scholarship** (`equityScholarship`) sits in a collapsed section under the payment options:
- Up to two seats per calendar year across all three Core tracks.
- Recipients get 5% off and can spread the total over 24 months with no fees.
- The scholarship can't be combined with another tuition discount: one discount per enrollment.
- The CTA is “Ask about the Equity Scholarship”, which goes to the admissions inquiry link. The existing scholarship application form is a secondary link.
- A remaining-seat count appears only if `verifiedSeats` is filled in from an admissions record, with `remaining`, `asOf` and `source`. The calculator never reserves or decrements seats.
- “Tuition and payment amounts are estimates. NWIOI will confirm your final tuition and payment schedule with you.” sits beside the options.

**Page order:**
1. Headline and credential picker.
2. **AASECT education requirements guide** for the chosen credential:
   - 90 hours of Core Knowledge Areas, at least 15 live.
   - 60 hours of the credential’s skills training, at least 30 live.
   - A note on the 14-hour SAR, separate from the 150 coursework hours.
   - **See the full education requirements** expands to:
     - the per-area minimum (3 hours) and cap (20 hours), with both area lists;
     - the time-sensitive CKAs;
     - the Therapist couples-counseling provision (16 hours);
     - the Counselor and Educator rule that at least 30 skills hours be field-specific;
     - links to AASECT’s Core Knowledge Areas page and the credential’s official requirements page.
   - All of this comes from the verified rulesets in `config/rulesets/`.
3. **Where prior learning came from:**
   - **College coursework:** “Did you take any relevant courses at an accredited college or university?” (Yes / No / I’m not sure).
     - The prompt is graduate coursework for Sex Therapist (advanced clinical degree), or undergraduate and graduate for Counselor and Educator (bachelor’s minimum). It links to AASECT’s Academic Qualifications page.
     - If yes, the visitor picks semester credits (× 15 clock hours) or class hours, and can estimate the relevant portion of a course.
   - **Continuing education:** “Have you earned continuing education credits from sexuality-related training?” (Yes / No / I’m not sure).
     - If yes, there are fields for AASECT-approved credits (hour for hour), credits from another professional CE body (half value) and unsure credits (pending review). Both types can be entered.
     - This works with no college coursework.
   - **I know my hours by category** (collapsed): Core Knowledge, skills training and live hours.
4. **“Here’s what may count toward your education requirements”**, directly below the questions:
   - **Payoff first:** “Your prior training could save you up to 25 hours and $875 in additional coursework.”
     - Two side-by-side tiles show the hours (with “about N full days”) and the hours × the $35 planning rate.
     - Then: “These hours haven’t been reviewed yet. If they count toward your credential and cover coursework you’d otherwise need to take, you could save up to $875… Admissions will help you confirm which hours count.”
     - The tiles use the same preliminary hour count shown in the result, and appear only once there are hours. The $35 planning rate is approved, so the dollar figures show publicly.
   - The hours that may count toward the 150, with college, CE and pending lines.
   - The required planning note: NWIOI helps review transcripts and CE certificates; AASECT makes the final determination.
   - Then **Review my prior training**.
   - **Two remaining-coursework figures, labeled separately** (shown once both category hours are entered):
     - **After Core Program:** Core’s 99 hours leave a 51-hour gap ($1,785 at $35 per hour), assuming all package hours apply. Prior coursework reduces that only where it covers what Core leaves open. With `core.curriculumMapping`, that's exact by category and overlap is counted once. Without a mapping, the reduced figure is shown as conditional and marked **Rough planning estimate**.
     - **À La Carte only (without Core), based on your answers:** (90 − core hours) + (60 − skills hours). For example, 60 + 29 gives 61 hours, or $2,135. The À La Carte row labels it **Estimated coursework still needed**, with the cost as “Estimated coursework cost at $35 per hour”.
   - Hours with an unknown category stay **unassigned**. A rough total never makes a category complete, and never gives a remaining-CEU or cost estimate or says how much can be skipped. Those appear only once both category hours are entered.
   - “I’m not sure” offers the transcript and CE review directly.
5. **Core Program** and **À La Carte** as two compact rows, with the comparison and builder behind secondary links.

The sticky estimate bar only slides in once the rows have scrolled away.

**Styling** follows nwioi.com and is scoped to the finder page:
- Colors: dark brown band (#482117), gold/tan square buttons (#D3A468), olive accent (#3D4C28).
- Fonts: Libre Baskerville headings, standing in for the site’s Bookmania, and Manrope text, both from Google Fonts.
- Mobile: tap targets are 44px or more, and body text is 16px or more.

No email, uploads or clinical-hour questions are asked.

**Prior-training result** (`priorCoverage` in `src/tracks.js`). The details are under “How we worked this out”:
1. **What you may already have covered.** Overlap is counted once.
2. **What NWIOI includes:** 99 CEUs, plus supervision and SAR.
3. **What you may still need.** This shows the remaining CEUs, a box for how many to take with NWIOI, an optional box for the expected cost of coursework with other institutes (“Other providers set their own prices”), and the **additional NWIOI coursework** cost at the planning rate ($35/CEU, draft). It ends with **NWIOI tuition** plus that, giving the **Estimated combined cost** and the planning sentence.

- **With a curriculum mapping** (`core.curriculumMapping: {core, skills}`, adding to 99), core and skills gaps are calculated separately and extra hours in one never fill the other.
- **Without one** (the current state for all three credentials), the gap is 150 − 99 = 51 hours. It's labeled **Rough planning estimate**, with a note that admissions reviews topics and live hours.
- If either education answer is unknown, the summary stays unresolved, and no additional or combined cost is guessed.

Example: 25 prior CEUs → 26 remaining → $910 → combined $9,110 / $8,360 / $7,860.

**À La Carte** shows one estimated NWIOI total and an expandable **See what’s included** list of quantities only. Unit rates, formulas, line amounts and subtotals never leave the server. The quantity boxes in the builder adjust it. SAR and NWIOI supervision are included only when selected. With outside supervision: “You’ll pay your outside supervisor separately.” On its option card, it’s labeled **Estimated cost if purchased separately**.

**Package savings** appear under **Compare full details** only when the separate purchase covers the same components and quantities: 99 CEUs, the same individual hours, the same group hours, and SAR. Group hours must divide evenly into À La Carte’s 3-hour sessions. So Sex Therapist (save $2,585) and Counselor (save $590) show savings. Educator (20 group hours) doesn’t.

**Recommendation** (only once the answers support it): À La Carte if supervision will be outside NWIOI, or at least 20% of the supervision target is done. Otherwise Core. The recommended card gets an outline and a “Recommended for you” chip. While the À La Carte builder is open, the bar shows its estimate.

**Next steps:**
- Primary: **Review my prior training** (admissions booking).
- Secondary: **Explore the NWIOI course library**, with “Additional NWIOI courses depend on current availability.”
- **Book a free admissions call** is in the pinned bar.
- **Equity Scholarship** sits under the Core payment options.
- Once the enrollment link is approved, “Ready to enroll?” also appears.

**Configuration.** Everything is in `config/tracks.json`, editable under Admin → **Tracks & tuition** and validated against the AASECT rulesets when saved (Core = 99 CEUs, includes SAR, supervision adds up to the credential target, mapping adds to 99). Only `"approved"` items show prices and links publicly. Drafts are visible to signed-in admins, or to everyone with `NWIOI_PREVIEW=1`, always labeled.

No email, transcripts, course inventory or clinical/client-contact hours are asked for. The detailed course-by-course estimator at `/detailed` is internal: it requires admin sign-in.

Local preview with draft tuition visible:

```bash
NWIOI_PREVIEW=1 npm start
```

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
