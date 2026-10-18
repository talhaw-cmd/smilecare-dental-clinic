-- SmileCare demo schema. Run in Supabase SQL Editor.
-- This app uses the service-role key only in the Express backend. Never expose it in frontend code.
create extension if not exists pgcrypto;

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  description text not null default '',
  duration_minutes integer check (duration_minutes is null or duration_minutes between 5 and 480),
  price numeric(10,2) check (price is null or price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_name text not null check (char_length(patient_name) between 2 and 100),
  email text,
  phone text not null check (char_length(phone) between 7 and 30),
  service_id uuid not null references public.services(id) on delete restrict,
  preferred_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','confirmed','completed','cancelled')),
  message text check (message is null or char_length(message) <= 1000),
  consent_to_contact boolean not null default false check (consent_to_contact = true),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists appointments_preferred_at_idx on public.appointments(preferred_at);
create index if not exists appointments_status_idx on public.appointments(status);
create index if not exists appointments_created_at_idx on public.appointments(created_at desc);

alter table public.services enable row level security;
alter table public.appointments enable row level security;
-- Intentionally no anon/authenticated policies: public reads/writes and all staff operations go through Express.

insert into public.services (name, description, duration_minutes, price, is_active)
select seed.name, seed.description, seed.duration_minutes, seed.price, true
from (values
  ('Teeth Cleaning', 'A gentle professional clean to help keep your smile fresh and healthy.', 30, 3500::numeric),
  ('Dental Check-up', 'A routine oral health check with clear guidance on your next steps.', 30, 2000::numeric),
  ('Smile Whitening', 'Discuss cosmetic whitening options suited to your smile.', 45, 8000::numeric),
  ('Braces Consultation', 'Explore orthodontic options and ask questions in a consultation.', 30, 2500::numeric),
  ('Root Canal Consultation', 'An assessment appointment to discuss symptoms and treatment options.', 45, 4000::numeric),
  ('Urgent Dental Visit', 'Request an urgent visit; the clinic will contact you to confirm availability.', 30, null::numeric)
) as seed(name, description, duration_minutes, price)
where not exists (select 1 from public.services existing where existing.name = seed.name);
