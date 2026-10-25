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
- Use shared browser-only photo export helpers with permission-filtered signed URLs; bulk exports build one flat in-memory ZIP (JSZip, loaded dynamically) and trigger a single download, filenames retain uploader identity, and no photo blobs are persisted, so downloads cannot bypass cleaner separation or alter originals.
- Bind new photo storage paths to tenant, appointment occurrence and authenticated uploader, validate that binding at registration and in the database, and flag unverifiable legacy attribution rather than reassigning it.
- Isolate offline query persistence by authenticated identity, clear queries on account changes, and exclude signed photo URLs from persistent caches to prevent cross-account photo display.
- Use ScheduleAppointmentDetails for schedule time/location text and snapshot-based labels, with natural height and contrast-selected semantic text colors on saved appointment backgrounds, so compact/list views remain consistent.
- Photo-upload emails use authenticated saved-photo batch finalization with a synchronous quiet window, deterministic activity-log claims, and managed email idempotency; keep privileged delivery in browser-inaccessible .server helpers, store settings/outcomes in the protected system activity-log namespace, never create email queues or dispatchers, and validate one active owner/manager recipient per event.
