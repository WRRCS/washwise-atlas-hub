-- The invoice email tells clients "You can pay via the link in this email", but no
-- link was ever put in the body. Add the app's public card-payment page.
update public.email_templates
set body_html = '<p>Hi {{client_name}},</p><p>Invoice <strong>{{invoice_number}}</strong> for <strong>{{amount}}</strong> is ready.</p><p>You can pay by card here: <a href="{{pay_link}}">{{pay_link}}</a></p><p>Thanks! — {{company_name}}</p>',
    updated_at = now()
where trigger_event = 'invoice_sent';