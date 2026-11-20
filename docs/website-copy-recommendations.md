# Website copy for the two-tier offer (draft for NWIOI approval)

Pages reviewed 2026-11-20:
- https://www.nwioi.com/aasect-certification
- https://www.nwioi.com/compare-certification-tracks
- https://www.nwioi.com/sex-education-program

Everything below is draft copy. None of the prices are marked approved in the calculator yet.

## Tier names

Use these two names everywhere: on the site, in the calculator and in the comparison.

- **Tier I · Core Program**
- **Tier II · À La Carte**

Remove "Tier I Comprehensive", "Tier II Core", "Tier III Modular" and "Tier III: Flexible". Remove the 150-CEU Comprehensive package from the student-facing pages.

## Calculator link

Add a button **See my tuition & how my training counts** near each tier summary and in the AASECT Certification menu. Supporting line:

> Choose your credential to see Core Program tuition, then see how your prior training could count. No email required.

## Prior-training section (use on the AASECT Certification page and in the calculator)

> **See how far your prior training can take you.**
> NWIOI Core includes 99 CEUs, supervision for your credential, and SAR. Graduate coursework and continuing education you've already completed may cover some or all of the remaining education. If you need additional courses, you can choose from the NWIOI library or learn with other institutes. We encourage you to learn from a range of educators and perspectives, and we'll help you find courses that fit the areas you still need.
> **[Review my prior training]**  [Explore the NWIOI course library]  [Book a free admissions call]
> *Additional NWIOI courses depend on current availability.*

Next to any combined estimate:

> This is a planning estimate. We'll review your prior training and coursework options together and confirm your NWIOI tuition before you enroll.

## Tier I · Core Program

> **Tier I · Core Program**
> 99 CEUs of NWIOI coursework • Supervision for your credential • SAR included
> Your credential calls for 150 education hours (90 Core Knowledge Areas + 60 credential-specific skills training). Core includes 99 CEUs. Your prior graduate coursework and continuing education may cover the rest. If not, you can take additional courses with NWIOI or another institute.

| Credential | Standard NWIOI tuition | Pay in full · Save 7% | Supervision included |
|---|---:|---:|---|
| Sex Therapist | $8,200 | $7,626.00 | 26 individual + 24 group hours, at least 18 months |
| Sexuality Counselor | $7,450 | $6,928.50 | 15 individual + 15 group hours, at least 12 months |
| Sexuality Educator | $6,950 | $6,463.50 | 5 individual + 20 group hours, at least 9 months |

> SAR is included in every Core price. If you've already completed a SAR, your tuition stays the same.
> **Explore scholarship and equity rates**

For Sexuality Educators, add:

> Design and deliver a sexuality education program with feedback from an AASECT Certified Sexuality Educator Supervisor.

## Tier II · À La Carte

> **Tier II · À La Carte**
> Choose individual courses, supervision, or SAR as you need them. Work with an NWIOI supervisor, or with an outside supervisor whom you pay separately. **[See my tuition & how my training counts]** to get one estimated NWIOI total for what you'd buy.

**Current site prices.** The current site lists À La Carte unit prices: $195/hour individual supervision and $200 per 3-hour group session. The calculator deliberately hides unit prices. Decide whether the website should keep showing them, since visitors could rebuild the calculator's math from them.

## Compare Certification Tracks page

Replace the three-column table with two columns.

| | Tier I · Core Program | Tier II · À La Carte |
|---|---|---|
| Education | 99 CEUs included | Courses you choose |
| Supervision | Included for your credential | NWIOI or outside, as needed |
| SAR | Included | Add if needed |
| Price | Fixed tuition by credential | One estimate for what you buy |
| Pay in full · Save 7% | Yes | No |

**Outdated figures to remove.**

| Current site | Replace with |
|---|---|
| Tier I $10,950; Pay in full $10,183; 12- and 24-month plans | Core tuition by credential (table above); recalculate the plans or remove them until approved |
| Tier II $9,500; Pay in full $8,835; plans; "SAR Add-On $850+" | Remove (SAR is now included in Core) |
| "50 supervision hours included" | "Supervision for your credential (25–50 hours)" |
| "Tier III: Flexible" / "Modular Track" | Tier II · À La Carte |

**Scholarship.** Replace "Contact us for scholarship and equity rates" with:

> **FIELD Growth Scholarship.** NWIOI offers a discounted rate for people with marginalized and intersecting identities who are underrepresented in sex therapy, sexuality counseling, or sexuality education and are experiencing financial need. Awards, and how they combine with pay in full, are subject to NWIOI review. **[View scholarship application]** **[Ask about equity rates]**

Link the application to `https://forms.wix.com/f/7167298250691576552`.

## Sex Education Program page

The page's existing "Fall/Spring Advanced classes (75 + 24 CEUs)" and "51 CEU gap" already match the 99-CEU Core model. Fold that page into **Tier I · Core Program**, and:
- Remove the old TOP5 prices ($8,441.25 / $7,263.75).
- Replace "we've intentionally chosen not to offer a comprehensive program" with the prior-training section above.
- Use "Sexuality Counselor", not "Sex Counselor".
- Remove the "Optional CME Add On: $450" unless it's still offered.

## Booking link

"Schedule Free Admissions Call" currently points to three places:
- student.nwioi.com/inquire
- student.nwioi.com
- nwioi.com/nwioi-application

Pick one, and set it under Admin → Links.

## To confirm before publishing

1. **Prices.** Approve the three Core tuitions, pay in full, the $35/CEU planning rate, and the À La Carte rates. All are `draft` in `config/tracks.json`.
2. **Curriculum mapping.** For each credential, how the 99 Core CEUs split between CKAs and skills training. Until it's set, the calculator uses the 51-hour gap and labels it a rough planning estimate.
3. **Course library URL.** `library.url` is empty, so "Explore the NWIOI course library" shows "link coming soon".
4. **Booking, enrollment, supervisors and sample-weekend links.** These are placeholders or empty.
5. **Savings rule.** Savings show only when À La Carte group sessions (3 hours) divide evenly into Core's group hours. So Sex Therapist (save $2,585) and Sexuality Counselor (save $590) show savings, and Sexuality Educator (20 group hours) doesn't. Confirm this, or set an Educator-specific group session length.
6. **Scholarship form.** Confirm that the form at the link above is still current.
