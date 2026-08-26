-- St. Jude Music Ministry volunteer accounts
-- Designed for the Supabase Free plan.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  account_name text not null check (char_length(account_name) between 2 and 100),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.household_users (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'adult' check (role in ('owner', 'adult')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.family_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 100),
  member_type text not null default 'adult' check (member_type in ('adult', 'child')),
  volunteer_id text not null check (volunteer_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$'),
  interests text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index family_members_volunteer_id_unique
  on public.family_members (lower(volunteer_id));

create index family_members_household_id_idx
  on public.family_members (household_id);

create table public.contact_methods (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  family_member_id uuid references public.family_members(id) on delete cascade,
  contact_type text not null check (contact_type in ('email', 'phone')),
  contact_value text not null check (char_length(contact_value) between 3 and 254),
  label text not null default 'Primary' check (char_length(label) between 1 and 40),
  is_primary boolean not null default false,
  volunteer_communications_allowed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contact_methods_household_id_idx
  on public.contact_methods (household_id);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 140),
  description text not null default '',
  category text not null default 'General',
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text not null default '',
  capacity integer check (capacity is null or capacity > 0),
  family_friendly boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);

create index opportunities_active_starts_at_idx
  on public.opportunities (active, starts_at);

create table public.signups (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  family_member_id uuid not null references public.family_members(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  status text not null default 'signed_up' check (status in ('signed_up', 'waitlisted', 'cancelled', 'completed')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_member_id, opportunity_id)
);

create index signups_household_id_idx on public.signups (household_id);
create index signups_opportunity_id_idx on public.signups (opportunity_id);

create or replace function public.add_household_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.household_users (household_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

create trigger add_household_owner_after_insert
after insert on public.households
for each row execute function public.add_household_owner();

create or replace function public.is_household_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_users hu
    where hu.household_id = target_household_id
      and hu.user_id = auth.uid()
  );
$$;

revoke all on function public.is_household_member(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;

create trigger households_set_updated_at before update on public.households
for each row execute function public.set_updated_at();
create trigger family_members_set_updated_at before update on public.family_members
for each row execute function public.set_updated_at();
create trigger contact_methods_set_updated_at before update on public.contact_methods
for each row execute function public.set_updated_at();
create trigger opportunities_set_updated_at before update on public.opportunities
for each row execute function public.set_updated_at();
create trigger signups_set_updated_at before update on public.signups
for each row execute function public.set_updated_at();

alter table public.households enable row level security;
alter table public.household_users enable row level security;
alter table public.family_members enable row level security;
alter table public.contact_methods enable row level security;
alter table public.opportunities enable row level security;
alter table public.signups enable row level security;

create policy households_select on public.households
for select to authenticated
using (
  (select auth.uid()) = created_by
  or public.is_household_member(id)
);

create policy households_insert on public.households
for insert to authenticated
with check (created_by = auth.uid());

create policy households_update on public.households
for update to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

create policy household_users_select on public.household_users
for select to authenticated
using (user_id = auth.uid() or public.is_household_member(household_id));

create policy household_users_insert on public.household_users
for insert to authenticated
with check (
  exists (
    select 1 from public.households h
    where h.id = household_id and h.created_by = auth.uid()
  )
);

create policy household_users_update on public.household_users
for update to authenticated
using (
  exists (
    select 1 from public.households h
    where h.id = household_id and h.created_by = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.households h
    where h.id = household_id and h.created_by = auth.uid()
  )
);

create policy household_users_delete on public.household_users
for delete to authenticated
using (
  role <> 'owner'
  and exists (
    select 1 from public.households h
    where h.id = household_id and h.created_by = auth.uid()
  )
);

create policy family_members_all on public.family_members
for all to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

create policy contact_methods_all on public.contact_methods
for all to authenticated
using (public.is_household_member(household_id))
with check (
  public.is_household_member(household_id)
  and (
    family_member_id is null
    or exists (
      select 1 from public.family_members fm
      where fm.id = family_member_id and fm.household_id = contact_methods.household_id
    )
  )
);

create policy opportunities_select on public.opportunities
for select to authenticated
using (active = true);

create policy signups_all on public.signups
for all to authenticated
using (public.is_household_member(household_id))
with check (
  public.is_household_member(household_id)
  and exists (
    select 1 from public.family_members fm
    where fm.id = family_member_id and fm.household_id = signups.household_id
  )
);

revoke all on table public.households from anon, authenticated;
revoke all on table public.household_users from anon, authenticated;
revoke all on table public.family_members from anon, authenticated;
revoke all on table public.contact_methods from anon, authenticated;
revoke all on table public.opportunities from anon, authenticated;
revoke all on table public.signups from anon, authenticated;

grant select, insert, update on table public.households to authenticated;
grant select, insert, update, delete on table public.household_users to authenticated;
grant select, insert, update, delete on table public.family_members to authenticated;
grant select, insert, update, delete on table public.contact_methods to authenticated;
grant select on table public.opportunities to authenticated;
grant select, insert, update, delete on table public.signups to authenticated;

comment on table public.contact_methods is
  'Stores multiple account emails and phone numbers. Phone numbers are used to validate accounts and for volunteer-related communications.';
-- St. Jude Music Ministry volunteer accounts
-- Designed for the Supabase Free plan.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  account_name text not null check (char_length(account_name) between 2 and 100),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.household_users (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'adult' check (role in ('owner', 'adult')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.family_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 100),
  member_type text not null default 'adult' check (member_type in ('adult', 'child')),
  volunteer_id text not null check (volunteer_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$'),
  interests text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index family_members_volunteer_id_unique
  on public.family_members (lower(volunteer_id));

create index family_members_household_id_idx
  on public.family_members (household_id);

create table public.contact_methods (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  family_member_id uuid references public.family_members(id) on delete cascade,
  contact_type text not null check (contact_type in ('email', 'phone')),
  contact_value text not null check (char_length(contact_value) between 3 and 254),
  label text not null default 'Primary' check (char_length(label) between 1 and 40),
  is_primary boolean not null default false,
  volunteer_communications_allowed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contact_methods_household_id_idx
  on public.contact_methods (household_id);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 2 and 140),
  description text not null default '',
  category text not null default 'General',
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text not null default '',
  capacity integer check (capacity is null or capacity > 0),
  family_friendly boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);

create index opportunities_active_starts_at_idx
  on public.opportunities (active, starts_at);

create table public.signups (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  family_member_id uuid not null references public.family_members(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  status text not null default 'signed_up' check (status in ('signed_up', 'waitlisted', 'cancelled', 'completed')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_member_id, opportunity_id)
);

create index signups_household_id_idx on public.signups (household_id);
create index signups_opportunity_id_idx on public.signups (opportunity_id);

create or replace function public.add_household_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.household_users (household_id, user_id, role)
  values (new.id, new.created_by, 'owner');
  return new;
end;
$$;

create trigger add_household_owner_after_insert
after insert on public.households
for each row execute function public.add_household_owner();

create or replace function public.is_household_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_users hu
    where hu.household_id = target_household_id
      and hu.user_id = auth.uid()
  );
$$;

revoke all on function public.is_household_member(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;

create trigger households_set_updated_at before update on public.households
for each row execute function public.set_updated_at();
create trigger family_members_set_updated_at before update on public.family_members
for each row execute function public.set_updated_at();
create trigger contact_methods_set_updated_at before update on public.contact_methods
for each row execute function public.set_updated_at();
create trigger opportunities_set_updated_at before update on public.opportunities
for each row execute function public.set_updated_at();
create trigger signups_set_updated_at before update on public.signups
for each row execute function public.set_updated_at();

alter table public.households enable row level security;
alter table public.household_users enable row level security;
alter table public.family_members enable row level security;
alter table public.contact_methods enable row level security;
alter table public.opportunities enable row level security;
alter table public.signups enable row level security;

create policy households_select on public.households
for select to authenticated
using (public.is_household_member(id));

create policy households_insert on public.households
for insert to authenticated
with check (created_by = auth.uid());

create policy households_update on public.households
for update to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());

create policy household_users_select on public.household_users
for select to authenticated
using (user_id = auth.uid() or public.is_household_member(household_id));

create policy household_users_insert on public.household_users
for insert to authenticated
with check (
  exists (
    select 1 from public.households h
    where h.id = household_id and h.created_by = auth.uid()
  )
);

create policy household_users_update on public.household_users
for update to authenticated
using (
  exists (
    select 1 from public.households h
    where h.id = household_id and h.created_by = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.households h
    where h.id = household_id and h.created_by = auth.uid()
  )
);

create policy household_users_delete on public.household_users
for delete to authenticated
using (
  role <> 'owner'
  and exists (
    select 1 from public.households h
    where h.id = household_id and h.created_by = auth.uid()
  )
);

create policy family_members_all on public.family_members
for all to authenticated
using (public.is_household_member(household_id))
with check (public.is_household_member(household_id));

create policy contact_methods_all on public.contact_methods
for all to authenticated
using (public.is_household_member(household_id))
with check (
  public.is_household_member(household_id)
  and (
    family_member_id is null
    or exists (
      select 1 from public.family_members fm
      where fm.id = family_member_id and fm.household_id = contact_methods.household_id
    )
  )
);

create policy opportunities_select on public.opportunities
for select to authenticated
using (active = true);

create policy signups_all on public.signups
for all to authenticated
using (public.is_household_member(household_id))
with check (
  public.is_household_member(household_id)
  and exists (
    select 1 from public.family_members fm
    where fm.id = family_member_id and fm.household_id = signups.household_id
  )
);

revoke all on table public.households from anon, authenticated;
revoke all on table public.household_users from anon, authenticated;
revoke all on table public.family_members from anon, authenticated;
revoke all on table public.contact_methods from anon, authenticated;
revoke all on table public.opportunities from anon, authenticated;
revoke all on table public.signups from anon, authenticated;

grant select, insert, update on table public.households to authenticated;
grant select, insert, update, delete on table public.household_users to authenticated;
grant select, insert, update, delete on table public.family_members to authenticated;
grant select, insert, update, delete on table public.contact_methods to authenticated;
grant select on table public.opportunities to authenticated;
grant select, insert, update, delete on table public.signups to authenticated;

comment on table public.contact_methods is
  'Stores multiple account emails and phone numbers. Phone numbers are used to validate accounts and for volunteer-related communications.';
