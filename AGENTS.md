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
- Store appointment location snapshots on jobs and copy them for recurrence/duplication; use job-location for display rather than client defaults, so unrelated client/property edits cannot redirect saved visits.
- Use the shared SopViewer for cleaner SOP access and dynamically import PDF.js only in the browser; render private signed documents locally so mobile viewing needs no external viewer or download.
- Deduplicate SOP representations by verified complete content and attachment identity, never filenames or the presence of text; retain files and unknown/visual-only content so unique instructions cannot disappear.
- Store property SOP acknowledgments by appointment occurrence and authenticated cleaner in job_sop_confirmations; keep legacy job fields as evidence, never as shared current progress.
- Keep Caddy Supplies expansion in page-local employee-ID state, independent of query data; unmount collapsed bodies and keep supply actions outside header buttons to prevent refresh and click-propagation regressions.
- Use shared browser-only photo export helpers with permission-filtered signed URLs; bulk exports build one flat in-memory ZIP (JSZip, loaded dynamically) and trigger a single download, filenames retain uploader identity, and no photo blobs are persisted, so downloads cannot bypass cleaner separation or alter originals.
- Bind new photo storage paths to tenant, appointment occurrence, authenticated uploader and captured assignment ID; registration verifies a stored image, database inserts reject missing/mismatched identity for all callers, immutable identity survives reassignment, and unverifiable legacy attribution stays flagged rather than reassigned.
- Preserve clicked schedule employee context through appointment photo reads; combined reviewer access is explicit, photo keys and mounted capture/export state include viewer/occurrence/cleaner, and uploads record immutable assignment identity without inferring the uploader from a selected tab.
- Isolate offline query persistence by authenticated identity, clear queries on account changes, and exclude signed photo URLs from persistent caches to prevent cross-account photo display.
- Use ScheduleAppointmentDetails for schedule time/location text and snapshot-based labels, with natural height and contrast-selected semantic text colors on saved appointment backgrounds, so compact/list views remain consistent.
- Photo-upload emails use authenticated saved-photo batch finalization with a synchronous quiet window, deterministic activity-log claims, and managed email idempotency; keep privileged delivery in browser-inaccessible .server helpers, store settings/outcomes in the protected system activity-log namespace, never create email queues or dispatchers, and validate one active owner/manager recipient per event.
- Explicit lunch splits paid intervals atomically via employee_clock_action; work_clock_entries stores unpaid lunch and unassigned work, time_entries keeps scheduled paid segments. Never subtract lunch again. Profile-row locking and cross-table interval guards enforce timer exclusivity, and admin lunch corrections adjust adjacent paid edges transactionally.
- Daily timesheets return original clock timestamps and null open ends; clip only duration calculations to the returned day window, so overnight edits cannot overwrite real times and weekly totals cannot double-count intervals.
- EmployeeClockControls belongs above employee appointment content independent of appointment queries; admin timesheets expose record management rather than self-clock controls, so an empty schedule never blocks employee clock-in.
- Cleaner action reminders reuse the private-secret push scheduler and existing arrival handlers; opt-in employee settings, unique occurrence/action keys, at-most-once delivery claims and fresh pre-send attendance/assignment checks prevent stale or duplicate alerts. Client channels remain separate.
- Admin desktop density is scoped through admin-layout and shared CSS sizing tokens; keep mobile employee typography unchanged and preserve schedule drag/drop handlers.
- Week-grid columns and minimum width live only in shared .schedule-row CSS tokens (no inline templates or fixed row min-w); desktop admin day tracks use minmax(0,1fr), narrow screens retain readable minimum tracks with overflow-aware arrow controls, and min-width:0 children remain inside a bounded .schedule-scroll so card content cannot push Sunday outside the container.
- Sidebar collapse is a per-device browser preference read through a useSyncExternalStore module store (server snapshot expanded), because AppShell remounts per page and must not flash or re-expand on navigation.
- PhotoShareDialog uses a bounded flex layout with fixed header/link actions/footer and one scrolling photo body; employee groups are keyed by uploader ID, not display name.
- Shared DialogContent bounds viewport height and provides sticky direct headers/footers so long forms retain accessible actions.
