/** Outlook acceptance is not a delivery receipt. Never retry an ambiguous POST. */
export async function sendOutlookAlert(recipient: string, subject: string, text: string) {
  const apiKey = process.env['LOVABLE_API_KEY'];
  const connectionKey = process.env['MICROSOFT_OUTLOOK_API_KEY'];
  if (!apiKey || !connectionKey) throw new Error('Outlook app connection is not available');
  const response = await fetch('https://connector-gateway.lovable.dev/microsoft_outlook/me/sendMail', {
    method:'POST', headers:{Authorization:`Bearer ${apiKey}`,'X-Connection-Api-Key':connectionKey,'Content-Type':'application/json'},
    body:JSON.stringify({message:{subject,body:{contentType:'Text',content:text},toRecipients:[{emailAddress:{address:recipient}}]},saveToSentItems:true}),
  });
  if (!response.ok) {
    const body = await response.text();
    console.error(`Outlook request failed [${response.status}]: ${body}`);
    throw new Error(`Outlook request failed [${response.status}]: ${body}`);
  }
  return { sent:true as const, status:'accepted' as const };
}