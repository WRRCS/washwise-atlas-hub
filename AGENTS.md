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
- Use shared browser-only photo export helpers with permission-filtered signed URLs; bulk exports build one flat in-memory ZIP (JSZip, loaded dynamically) and trigger a single download, filenames retain uploader identity, and no photo blobs are persisted, so downloads cannot bypass cleaner separation or alter originals.
- Bind new photo storage paths to tenant, appointment occurrence and authenticated uploader, validate that binding at registration and in the database, and flag unverifiable legacy attribution rather than reassigning it.
- Isolate offline query persistence by authenticated identity, clear queries on account changes, and exclude signed photo URLs from persistent caches to prevent cross-account photo display.
- Use ScheduleAppointmentDetails for schedule time/location text and snapshot-based labels, with natural height and contrast-selected semantic text colors on saved appointment backgrounds, so compact/list views remain consistent.
- Photo-upload emails use authenticated saved-photo batch finalization with a synchronous quiet window, deterministic activity-log claims, and managed email idempotency; keep privileged delivery in browser-inaccessible .server helpers, store settings/outcomes in the protected system activity-log namespace, never create email queues or dispatchers, and validate one active owner/manager recipient per event.
- Explicit lunch splits paid intervals atomically via employee_clock_action; work_clock_entries stores unpaid lunch and unassigned work, time_entries keeps scheduled paid segments. Never subtract lunch again. Profile-row locking and cross-table interval guards enforce timer exclusivity, and admin lunch corrections adjust adjacent paid edges transactionally.
- Cleaner action reminders reuse the private-secret push scheduler and existing arrival handlers; opt-in employee settings, unique occurrence/action keys, at-most-once delivery claims and fresh pre-send attendance/assignment checks prevent stale or duplicate alerts. Client channels remain separate.
