<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Send runtime employee invitation emails synchronously through Lovable's managed email API; never enqueue them in the notifications table, because this project has no email dispatcher.
- Store appointment location snapshots on jobs and copy them for recurrence/duplication; display job-location, not client defaults, so client/property edits cannot redirect saved visits.
- Use the shared SopViewer for SOP access and dynamically import PDF.js only in the browser; render private signed documents locally so mobile viewing needs no external viewer.
- Deduplicate SOP representations by verified complete content and attachment identity, never filenames or the presence of text; retain files and unknown/visual-only content so unique instructions cannot disappear.
- Store property SOP acknowledgments by appointment occurrence and authenticated cleaner in job_sop_confirmations; keep legacy job fields as evidence, never as shared current progress.
- Keep Caddy Supplies expansion in page-local employee-ID state, independent of query data; unmount collapsed bodies and keep supply actions outside header buttons to prevent refresh and click-propagation regressions.
- Use shared browser-only photo export helpers with permission-filtered signed URLs; bulk exports build one flat in-memory ZIP (JSZip, loaded dynamically) and trigger a single download, filenames retain uploader identity, so downloads cannot bypass cleaner separation or alter originals.
- Bind new photo storage paths to tenant, appointment occurrence, authenticated uploader and captured assignment ID; registration verifies the stored image and any caller's insert rejects missing/mismatched identity, identity survives reassignment, unverifiable legacy attribution stays flagged, and photo keys plus capture/export state carry viewer/occurrence/cleaner (clicked schedule context preserved, combined reviewer access explicit) instead of inferring the uploader from a tab.
- Clear queries and photo outbox on account change; signed URLs memory-only (grids use thumb_url). All captures (Photos tab, Leaving hand-off) use jobPhotoQueue's per-user IndexedDB outbox, resent app-wide by PhotoOutboxSender, so photos never cross accounts, get lost, or block capture/leaving.
- Use ScheduleAppointmentDetails for schedule time/location text and snapshot labels, with natural height and contrast-selected semantic colors on saved appointment backgrounds, so compact/list views stay consistent.
- Photo-upload alerts (email + per-owner/manager opt-in push via announceSavedPhotoBatch): batch finalization, one synchronous quiet window, activity-log claims; privileged delivery stays in .server helpers, never queues.
- Outlook owner alerts run synchronously after saved clock/photo actions with at-most-once activity-log claims (sendMail has no idempotency); never alert on lunch transitions or corrections.
- Explicit lunch splits paid intervals atomically via employee_clock_action; work_clock_entries stores unpaid lunch and unassigned work, time_entries keeps scheduled paid segments — never subtract lunch again. Profile-row locking and interval guards enforce timer exclusivity; admin corrections adjust adjacent paid edges transactionally; arrivals go only through locked record_job_arrival.
- Daily timesheets return original clock timestamps and null open ends; clip only duration calculations to the returned day window, so overnight edits cannot overwrite real times and weekly totals cannot double-count intervals.
- EmployeeClockControls belongs above employee appointment content independent of appointment queries; admin timesheets expose record management rather than self-clock controls, so an empty schedule never blocks employee clock-in.
- Cleaner action reminders reuse the private-secret push scheduler and arrival handlers; opt-in settings, unique occurrence/action keys, at-most-once claims and fresh pre-send checks prevent stale or duplicate alerts.
- Employee reminder pilots use manager-selected participants and a database delivery gate; claims lock the employee and recheck eligibility, keeping nonparticipants and other queues isolated.
- Offline registration keeps root scope while Web Push uses a distinct messaging scope and verified browser registration; signed-in ownership checks and sign-out cleanup prevent worker replacement and shared-device identity reuse.
- Admin desktop density is scoped through admin-layout and shared CSS sizing tokens; keep mobile employee typography unchanged and preserve schedule drag/drop handlers.
- Week-grid columns/min width live only in shared .schedule-row CSS tokens (no inline templates or row min-w); desktop tracks use minmax(0,1fr), narrow screens keep readable minimums with overflow-aware arrows, and min-width:0 children stay inside a bounded .schedule-scroll so cards cannot push Sunday out.
- Sidebar collapse is a per-device browser preference read through a useSyncExternalStore module store (server snapshot expanded), because AppShell remounts per page and must not flash or re-expand on navigation.
- PhotoShareDialog uses a bounded flex layout with fixed header/link actions/footer and one scrolling photo body; employee groups are keyed by uploader ID, not display name.
- Shared DialogContent bounds viewport height and provides sticky direct headers/footers so long forms retain accessible actions.
- Property type uses client_properties as the source of truth, with an insert/property-change trigger saving missing types and snapshotting each new job; property edits never cascade into saved jobs. Scheduling drafts key to client/property; service type stays independent.
- Admin timesheet corrections use one employee-locked atomic RPC with optimistic original-value checking, append-only audit history and attendance overrides; work/drive stay paid clock intervals and lunch splits paid work/arrival without altering shared job status.
- Cleaner training text lives only in src/lib/cleaner-training.json, shared by /training and the scripts/training PDF generators (one PDF per guide per language); screenshots/PDFs come from a temporary demo tenant, so real client data never appears.
- InvoiceEditor notifies its parent after successful persistence so same-invoice navigation exits edit mode; the send search flag opens confirmation only, never sends email.
- Invoice numbers come only from next_invoice_number(tenant, invoice date): invoice-date year plus a per-year sequence from 1001; callers pass the issue date so years roll over. Tenant prefix/series columns are deprecated.
- Owner pay-rate edits write profiles through the signed-in owner client (the privileged-field trigger resets admin-client writes) and confirm via an admin read, because wage columns are not selectable by authenticated users.

- Employee UI text uses useT/translateNow keyed by English source in the i18n.tsx UK dictionary; SOP text uses *_uk columns via usePick, so gaps fall back to English.
- Change cleaners only via updateJobAssignees: validate all visits first, never remove a cleaner with recorded work on that visit, keep the current lead in jobs.assigned_to (RLS reads it).
- Staff invites create the sign-in account with the existing profile id, so invites never spawn a second empty team member.
- Schedule paste/cross-cleaner drag joins a matching job via findPasteTarget (same client/property/service/day, overlapping, not open/canceled); only Duplicate job or no match creates one, so a cleaning stays one job/invoice.
- Property inventory: lists in property_inventory_items; per-visit values shared by the appointment's cleaners in job_inventory_checks, written only via save_job_inventory (rechecks assignment and item type).
