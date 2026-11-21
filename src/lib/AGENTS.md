# src/lib notes

- Public /pay links need the invoice's pay_token (?k=); build them only with invoicePayUrl(origin, id, token), so an invoice id alone never reveals details.
