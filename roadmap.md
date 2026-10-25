# Roadmap

- [x] Removed verified text/source-PDF duplication without deleting files; preserve unknown or visual-only attachment instructions and deduplicate repeated attachment identities. Signed-in Fern displays the readable SOP and acknowledgment once on desktop/mobile; BBWSD document-only SOP renders one five-page preview on both. Per-cleaner/occurrence confirmations replace shared progress; save/reload and cleanup verified. Twelve tests pass.

- [x] Added opt-in per-cleaner clock-in/arrival timing in Notifications, configured push only, direct existing-action links, live eligibility checks and unique/atomic delivery claims. Existing arrival also clocks in when needed; scheduled clock-in already records arrival. No workflow replaced.
- [x] Verified settings save/reload as Barbra with sends disabled; simulated test accounts cover lunch, active work, saved arrival, cancellation, completion, reassignment, rescheduling, Pacific DST and concurrent duplicate prevention. No real notifications created or sent; actual new-reminder device receipt intentionally unverified.

- [x] Add explicit unpaid lunch, described unscheduled work and exclusive active timers; database mutations restricted to authenticated atomic actions.
- [x] Add admin lunch correction, same-record job association and separate daily/weekly paid/lunch totals; payroll and productivity include unassigned work.
- [x] Verify full flow signed in as Barbra and Zoe, persisted lunch across refresh, duplicate-start prevention and cleaner correction denial. Admin correction verified 7h30 paid/30m lunch → 7h15 paid/45m lunch; job association preserved record IDs. Controlled rows removed, no notifications sent; five total tests pass.

- [x] Explained the sample's nonexistent appointment link; signed-in Zoe verification confirms a real appointment opens directly to Photos, and signed-out links preserve the destination through sign-in. No additional emails sent.

- [x] Added grouped owner/admin photo-upload emails, single server-validated recipient, protected settings and delivery history, selected property attribution, whole slow-batch grouping, stable provider keys and durable duplicate claims. Defaults off until an owner selects a recipient and enables.
- [x] Controlled sample accepted twice with the same key produced one managed sent event; Leslie confirmed receipt at info@washrinserepeatcleaning.com. Local isolated delivery tests verify grouping, attribution, failures and concurrent duplicate prevention. Owner settings save/read verified signed in as Zoe without enabling sends.
- [ ] Verify a new real cleaner upload through email delivery — blocked: real uploads also trigger staff push alerts, which Leslie prohibited during this test. Controlled email and isolated saved-batch tests verified instead.

- [x] Bind new uploads to their authenticated cleaner and occurrence; isolate account caches, flag 1,102 legacy records lacking independent uploader evidence, simplify controls, and deduplicate exports without changing originals. No reliably conflicting legacy storage owners found; no guessed reassignment.
- [x] Verify existing Barbra/Dalton photo separation signed in as each: 48 Barbra images and 17 Dalton images; one valid unique ZIP each, exact two-image selections, individual image downloads, and duplicate-click protection. 17 unit tests pass; all 1,238 originals remain.
- [ ] Verify new uploads from both cleaners end-to-end — blocked: live test uploads would trigger staff notifications; no test sends authorized. Ownership binding tested locally instead.

- [x] Bulk photo download = one flat ZIP (all / this cleaner / selected) with progress and retry of missing photos.
- [x] Verify a real 48-photo appointment ZIP signed in as Barbra.

- [x] Improve existing week-grid, schedule-list and day-queue readability with 15–16px wrapped times and snapshot locations; browser fixtures verify long addresses/unit numbers on desktop/mobile and location tests pass.
- [ ] Verify actual signed-in schedule actions and multi-cleaner appointments — blocked: no active requesting-user session; preview sign-in required. No month schedule view currently exists.

- [x] Add individual, selected, cleaner-only and all-cleaner photo downloads with compatible image files and progress.
- [x] Verify actual fixture image/ZIP downloads, exact selections, cleaner folders, JPEG conversion and phone-sized save controls; seven unit tests pass.
- [x] Verify downloads on an existing two-cleaner appointment; stored photo counts unchanged (Barbra 585, Dalton 653).

- [x] Open saved SOP content directly inside appointments, with inline documents and phone-friendly controls.
- [x] Verify one-tap SOP viewing signed in as Barbra on her Fern appointment: actual four-page saved PDF renders on phone, zoom works, Close returns to the same appointment; seven unit tests pass.

- [x] Preserve appointment-selected addresses across saving, recurring visits, cleaner views and notifications; address tests pass.
- [ ] Verify scheduling-to-cleaner workflow signed in — blocked: requesting user has no matching account/session; preview sign-in required.

- [x] Open shifts row above the schedule dates (unassigned jobs; owners drag/assign, employees can claim)
- [x] Dashboard: today's jobs from the actual schedule (replaces Ongoing / Completed screenshot tabs)
- [x] Arrived / Leaving buttons on each job (per-appointment visit times)
- [x] Timesheet tab: clock in/out + each appointment's arrive/leave, decimal time toggle
- [x] Service Types: remove pricing from the page and choose duration in hours and minutes
- [x] Team tab: screenshot-inspired searchable roster with permitted contact/pay and status
- [x] Tip tracker: overpayment above invoice total split evenly; employees see own tips
- [x] Publish schedule options: notify everyone / affected / no one; client email or text drafts
- [x] Employees page: tidy rows — email and phone in their own columns, phone formatted, actions in a three-dot menu
- [x] Alerts to owners/managers for team messages and job photos (grouped per job)
- [x] Job photos shown in Before / After / Damage / Other sections; no photo count limit
- [x] Arrived = clock in; Clock out replaces Complete/Start job for cleaners; cancel job owner/manager only
- [x] Phone bottom menu shows every option (scrolls)
- [x] Timesheet: owners/managers edit, delete, or clock out time entries
- [x] Team tab shows no wages for anyone (roster column, export and messages view)
- [x] Admin app: Pay rate column on the Employees roster (owners + wage permission only)
