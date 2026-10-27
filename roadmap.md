# Roadmap

- [ ] Targeted final calendar width correction: fit all seven days at 1280/1366/1440 with both sidebar states, preserve font sizes/data/drag-and-drop, provide narrow-screen scroll controls, and measure Sunday's rendered edge on populated eight-employee schedule.

- [x] Keep gallery header/actions visible with independently scrolling previews and generated-link actions; group by uploader ID and preserve share/download services.
- [x] Compact admin desktop navigation and weekly schedule using shared layout standards; root font restored to 16px, admin sidebar 208px, times 15px, names 14px, addresses 13px. Employee mobile unchanged; shared dialogs have bounded scrolling/sticky actions.
- [x] Signed-in Zoe: 19-photo create/copy/email draft/incognito individual image/19-image ZIP/revoke passed. Large gallery (66 selected): footer visible at laptop/125%-equivalent/mobile; link/copy/email draft/public download/55 valid-image ZIP/revoke passed. Nineteen unit tests pass, preview build OK. Email draft only, no emails sent. Native same-cell drag/drop exercised without mutating schedule; new-job footer visible at all sizes.
- [ ] Full large-gallery completeness verification — blocked: existing photos intermittently fail to load/sign; public gallery omits unavailable images (55 of 66 during final test). No original photo data/storage altered. Actual cross-date/reassignment drag not performed on live records; true browser 125% tested via equivalent CSS viewport, not browser zoom. Not published.

- [x] Restored one-image selected/all downloads and per-card Download; verified actual PNG and multi-photo flat ZIP downloads with isolated browser samples. Bulk ZIP finding contradicts the later preference and is false positive.
- [x] Preserved original overnight clock timestamps and null open ends; daily/weekly paid/lunch totals and daily export durations use separate day bounds. All 26 focused tests pass; preview build OK.
- [ ] Signed-in real-appointment and overnight timesheet checks for this monitoring fix — blocked: no requesting-user login session or matching account; no real records modified. Changes are not published in this turn.

- [x] Hardened all database inserts against missing/mismatched tenant, occurrence, uploader and assignment; capture-time assignment is encoded in storage paths and stale reassignment uploads rejected. Registration checks successful stored images. Immutable identity survives reassignment; photo shares/invoice reads enforce related jobs/clients.
- [x] Isolated two-employee tenant: NEW uploads A=2/B=0 then B=1/A=2, refresh, previews, unique correct ZIP contents and empty next occurrence passed. Backend tests rejected missing uploader, other occurrence/cleaner/assignment, ownership transfer and stale assignment; old ownership remained unchanged. Twenty-five unit tests plus two persistent browser regression tests passed (sandbox browser executable fallback).
- [x] Requested deployment and verified wrrcs.com with both synthetic employee logins: counts, loaded previews, refresh, actual ZIP images and initially empty next occurrence. Repeated NEW uploads on published app A=2/B=0 then B=1/A=2. Isolated test-only queued alerts had no real recipients or devices; no real staff/client messages sent.

- [x] Identified lost schedule cleaner context: Romeo's row opened shared galleries. Preserve clicked cleaner, explicit combined review, authenticated viewer/occurrence/cleaner cache and mounted state, immutable upload assignment identity, capture login checks, realtime publication plus refresh fallback. BBWSD's 44 photos are recorded under Dalton; no independent legacy storage owner exists, so retain review flags and do not reassign originals.
- [x] Verified signed in as Zoe: Romeo BBWSD row shows zero images, Dalton row shows 44, actual ZIP contains 44 valid Dalton-only images. Signed in as Dalton: same 44 after reload on desktop and phone. Twenty unit tests pass; source photo count unchanged.
- [x] New two-account uploads verified using synthetic employees without needing Romeo app access or real-staff sends; published and preview flows passed. Actual same-browser account-switch during an in-flight upload and real-device push delivery remain unverified.

- [x] Prominent My clock above employee appointment content, independent of empty schedules; admin timesheet self-clock removed while review/correction/association tools remain. Entries labeled Unscheduled work.
- [x] Verified as Leslie Walker (employee, no appointments today): described clock-in, duplicate rejection, explicit lunch persisted across reload, resume, clock-out, employee/admin read-back. Admin corrected the same three records; both views show 7.50 paid hours and 0.50 unpaid lunch. Desktop/mobile checked; six total tests pass; no notifications sent.

- [x] Fixed page-local employee-ID expansion: collapsed on entry/return, independent toggles, unmounted collapsed supplies and isolated controls. Verified signed in as Zoe on desktop/mobile: inspect, save unchanged supplies, refresh without reopening another employee, full collapse and return reset; no duplicate sections or page errors. Three tests pass.

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
- [x] Weekly calendar layout fix + collapsible sidebar (expanded 208px / collapsed 60px, remembered per device, icon tooltips). All 7 days fit at 1280/1366/1440/1920 at 100% zoom, both sidebar states; 125%-zoom equivalent and tablet scroll inside the grid to Sat/Sun. Not published.
