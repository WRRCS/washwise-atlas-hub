create table if not exists public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  direction text not null check (direction in ('inbound', 'outbound')),
  from_number text not null,
  to_number text not null,
  body text not null,
  status text not null default 'received',
  twilio_sid text,
  read_at timestamptz,
  read_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

GRANT SELECT, INSERT, UPDATE ON public.sms_messages TO authenticated;
GRANT ALL ON public.sms_messages TO service_role;

create index if not exists idx_sms_messages_tenant_created on public.sms_messages (tenant_id, created_at desc);
create index if not exists idx_sms_messages_client on public.sms_messages (client_id, created_at desc);
create index if not exists idx_sms_messages_unread on public.sms_messages (tenant_id) where read_at is null;

alter table public.sms_messages enable row level security;

create policy "sms_messages_select_own_tenant"
  on public.sms_messages for select
  using (tenant_id = public.current_tenant_id());

create policy "sms_messages_insert_own_tenant"
  on public.sms_messages for insert
  with check (tenant_id = public.current_tenant_id());

create policy "sms_messages_update_own_tenant"
  on public.sms_messages for update
  using (tenant_id = public.current_tenant_id());