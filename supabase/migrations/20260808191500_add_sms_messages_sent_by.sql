-- ============ FIX: sms_messages missing sent_by column ============
-- src/lib/sms.functions.ts inserts `sent_by: <user id>` on every outbound send,
-- but the live sms_messages table (created by the duplicate migration
-- 20260801184452_...sql, see 20260808190000_fix_sms_messages_rls_duplication.sql)
-- never got this column -- only `read_by`, which nothing in the app reads or
-- writes. Every staff-sent outbound SMS insert has been failing against
-- PostgREST with "could not find the 'sent_by' column" until this runs.

ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS sent_by UUID REFERENCES auth.users(id);
