# Upgrade Summary — Logo, Signatures & Professional PDF Reports

This upgrade builds on the existing cloud-sync version (login, D1,
attendance timestamps) already deployed at your Worker URL. **No UI was
redesigned** — the existing screens, colors, navigation and workflows are
unchanged; only the additions described below were made, in the same
visual style as everything around them.

## 1. Files changed

**New files:**
- `worker/migrations/0002_branding.sql` — adds logo/signature columns.
- `js/image-processing.js` — logo resize + signature background removal.
- `js/pdf-reports.js` — Individual and Monthly-All-Students PDF generation.
- `UPGRADE-SUMMARY.md` — this file.

**Edited files:**
- `worker/src/index.js` — settings API now reads/writes `logoData`,
  `headName`, `headSignatureData`, `staffSignatureData`; added a
  server-side size guard on those fields; bulk restore now round-trips
  them too.
- `index.html` / `js/app.js` — first-time setup form gained four optional
  fields (Logo, Head Name, Head Signature, Staff Signature), styled
  identically to the existing fields on that same form.
- `settings.html` / `js/settings.js` — same four fields added to the
  existing "Tuition Center Information" card, with preview thumbnails and
  a "Remove" button for the logo/each signature. Also fixed two leftover
  sentences that still described the app as local-only/offline (now
  accurately describe cloud sync — no layout change).
- `reports.html` / `js/reports.js` — added a "Download PDF" button next
  to the existing "Print Report" button (Student tab), and a new
  "Monthly (All)" tab with a Month/Year picker and a generate button,
  using the same tab/card/button classes as the three tabs already there.
- `service-worker.js` — cache list updated for the two new JS files,
  cache version bumped.

**Not touched:** `css/style.css`, `manifest.json`, `icons/`, Excel export
code in `js/utils.js` (`tmBuildAttendanceWorkbook` etc.), `js/students.js`,
`js/fees.js`, `js/attendance.js` business logic, `js/backup.js`,
`js/db.js`, `js/migrate.js`, `js/legacy-local-db.js`.

## 2. Database changes

One additive migration, `worker/migrations/0002_branding.sql`:

```sql
ALTER TABLE settings ADD COLUMN logo_data TEXT;
ALTER TABLE settings ADD COLUMN head_name TEXT;
ALTER TABLE settings ADD COLUMN head_signature_data TEXT;
ALTER TABLE settings ADD COLUMN staff_signature_data TEXT;
```

Existing rows get `NULL` for these columns, which the API turns into
`""` for the frontend — no existing account's row is deleted or altered
otherwise, and the app treats an empty value exactly like "nothing
uploaded yet" everywhere (setup, settings, and PDF generation).

## 3. Worker/API changes

- `settingsToApi()` now includes `logoData`, `headName`,
  `headSignatureData`, `staffSignatureData` (always a string, never
  `null`, so the frontend never has to special-case a missing value).
- `handlePutSettings()` validates each image field is under ~500KB of
  actual image data (base64-encoded) before writing, rejecting with a
  clear 413 error otherwise — a backstop behind the client-side
  resizing, not the primary size control.
- `handleBulkRestore()` (used by both "Restore from Backup" and the
  legacy-local-data migration) now carries these four fields through
  too, so a full backup/restore round-trips branding correctly.
- No new authentication surface, no new secrets — everything still rides
  on the same session-token auth and per-`user_id` scoping as before.

## 4. Frontend changes

- Setup screen and Settings page both gained the same four optional
  fields, wired through two small shared helpers in `js/app.js`
  (`tmWireImagePreview`, used by both pages) so a file picked there is
  processed and previewed identically in both places.
- Settings additionally preloads existing saved images into their
  previews (via `tmPreloadImagePreview`) and offers a "Remove" button
  per image (via `tmWireRemoveImageButton`) — removing just clears that
  field on next Save, it doesn't touch anything else.

## 5. Report-generation changes

Two PDF reports, built with jsPDF (loaded from a CDN `<script>` tag on
`reports.html`, the same on-demand pattern already used for the Excel
library elsewhere in the app):

- **Individual Student Report** (`tmGenerateIndividualReportPdf`) — same
  all-time attendance/fee numbers as the existing on-screen "Student"
  report tab (both call the same `tmAttendanceStats`/`tmFeesSummary`
  helpers), now laid out as a branded, signed, downloadable/shareable
  PDF instead of only being printable.
- **Monthly All-Students Report** (`tmGenerateMonthlyAllStudentsReportPdf`)
  — one dedicated page per active student for a chosen month/year, each
  with the logo header, that student's attendance stats for the month
  (via the same `tmDateInRange` month-boundary logic the Attendance
  report tab already uses), a fee status derived from `monthlyFee` vs.
  payments tagged for that month (`payment.forMonth`) — see the note on
  "PAID/PENDING" below — and the appropriate signature layout.
- Both **re-fetch students/attendance/payments/settings from the cloud
  API immediately before generating**, rather than reusing whatever the
  Reports page loaded when it first opened, so a report always reflects
  the latest synced data.
- Student names are drawn as real PDF text (not images), so they're
  searchable in any PDF viewer.
- Page numbers and the "Centre Name · Month Year" footer are stamped in
  one pass after all pages exist (`tmStampFootersAndPageNumbers`), so the
  "Page X of Y" total is always correct even for long, many-student
  reports.
- Zero-class months render "N/A" instead of a misleading "0%" **only in
  the PDF** — the shared `tmAttendanceStats` function itself is
  unchanged, so no existing on-screen report's numbers changed.
- Filenames are sanitized (`tmSanitizeFilename`) and follow the pattern
  `<Centre>-<Student>-<Month>-Report.pdf` / `<Centre>-Monthly-Student-Reports-<Month>.pdf`.
- Download works everywhere; on a device/browser that supports the Web
  Share API with files (most modern Android browsers), a native Share
  sheet is offered too, so the PDF can go straight into WhatsApp — no
  WhatsApp API/login involved, exactly as specified.

**One judgment call worth knowing about:** the app has no existing
"amount due this month" concept — payments are a running ledger with an
optional `forMonth` tag, not a bill/invoice system. Rather than invent a
due-date/billing model that doesn't exist elsewhere in the app, the
monthly report's PAID/PENDING/PARTIALLY PAID status is computed only
from data the app already has: `student.monthlyFee` compared against the
sum of that student's payments tagged for the selected month. If a
student has no `monthlyFee` set, the report shows "NOT TRACKED" rather
than guessing a status.

## 6. Logo handling

Client-side only (`js/image-processing.js`, `tmProcessLogoFile`):
resized to fit within 480px on its longest side (never upscaled),
re-encoded as PNG (keeps transparency), then sent to the Worker as a
base64 data URL and stored in the `settings.logo_data` column, scoped to
that account like everything else in that table. PDF logo uploads are
explicitly rejected with a message asking for a PNG/JPG/WebP export
instead (see item 51 of your brief) — adding a PDF-rendering library
just to extract one page/image wasn't worth the extra dependency weight
for this use case.

## 7. Signature background-removal method

Also entirely client-side, no ML/server call involved
(`tmProcessSignatureFile` in `js/image-processing.js`):

1. Resize to fit within 640px on its longest side.
2. Sample a small patch at each of the four corners and average them
   into one reference "background" color (robust to scan noise/JPEG
   artifacts, unlike sampling a single pixel).
3. For every pixel, measure its color distance from that background
   color: pixels close to it become fully transparent; pixels far from
   it (the ink) are left untouched; pixels in between get a
   proportionally reduced alpha, so stroke edges stay smooth instead of
   a jagged cutout.
4. Auto-crop the result to the bounding box of the remaining
   (non-transparent) pixels, with a small padding margin.

This only ever *removes* pixels close to the sampled background — it
never redraws, invents, or thickens a stroke, satisfying "use only the
real uploaded signature." If the source image already has transparency,
its already-transparent pixels are left alone. This is a well-understood
thresholding technique, not perfect on every possible background (a
patterned or unevenly lit scan can leave faint edges) — see Limitations.

## 8. Security changes

- New `handlePutSettings` size validation (see §3) prevents an oversized
  or malformed image payload from ever reaching D1.
- No new attack surface for cross-user access: the four new fields live
  in the same `settings` row that was already scoped by `user_id` and
  ownership-checked on every request.
- Nothing new is exposed in Excel export (still untouched) or in JSON
  backups beyond the branding data itself (no secrets are or ever were
  in the settings table).

## 9. Migration instructions

See the "What's new in this upgrade" section at the top of
`DEPLOYMENT.md` — in short: `npm run db:migrate:remote` then
`npm run deploy` from the `worker` folder. No frontend config changes
needed since `js/config.js` already points at your Worker.

## 10. Deployment instructions

Same as above — see `DEPLOYMENT.md`.

## 11. Testing results

I was not able to run the acceptance-test matrix from the brief myself —
I don't have a live Cloudflare account, a phone to test the Web Share
sheet on, or real signature photos to verify the background-removal
threshold against. What I did verify directly:
- Every JS file (frontend and Worker) parses without syntax errors.
- Every HTML file's `<script>` tags are balanced and reference files that
  exist.
- The individual report's numbers are pulled from the exact same helper
  functions (`tmAttendanceStats`, `tmFeesSummary`) as the on-screen
  report, so they cannot drift apart.

Please run through section 10 ("Testing checklist") of `DEPLOYMENT.md`
plus the logo/signature/report-specific tests from your brief (items
116–127) after deploying, and tell me exactly what you see if anything
looks off — especially how the background removal looks on your actual
signature photos, since that's the one piece of this upgrade I couldn't
validate against a real photo.

## 12. Limitations

- **Background removal is a threshold-based technique, not true
  segmentation.** It works well for a signature on fairly even white or
  light-grey paper (the common case), but a heavily shadowed, wrinkled,
  or patterned background may leave faint transparent-edge artifacts.
  There's no way to fully solve this in-browser without a much heavier
  ML-based library, which felt disproportionate for this feature.
- **PDF logo/signature uploads aren't supported** — you'll get a message
  asking for a PNG/JPG/WebP instead (see §6).
- **Fee status per month is derived, not stored** — see the note at the
  end of §5. If you later want a real "amount due" concept (e.g. prorated
  for mid-month joiners), that would be a separate, larger feature.
- Images are capped at roughly 500KB (server-side) / resized to at most
  480–640px client-side before upload, to keep D1 rows small — very
  high-resolution source photos are intentionally downscaled.
