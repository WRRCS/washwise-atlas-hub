REVOKE SELECT (email, phone, billing_address) ON public.clients FROM authenticated;
REVOKE SELECT (email, phone, billing_address) ON public.clients FROM anon;