# src/lib notes

- Public /pay links need the invoice's pay_token (?k=); build them only with invoicePayUrl(origin, id, token), so an invoice id alone never reveals details.
- Cleaners can write jobs only to move status forward and stamp actual_start/actual_end at the current time (guard_employee_job_billing allowlist); add any new cleaner-side job write as a checked SECURITY DEFINER RPC, so cleaning details stay manager-only.
- Business texts (sms_messages, sms.functions, sendClientSms) are owner/manager-only at both the database and server level, so cleaners never see client conversations.
