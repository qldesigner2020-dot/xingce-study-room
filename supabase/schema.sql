-- Run once in the new project's SQL Editor. No practice data is included.
create table if not exists public.study_accounts (
  email text primary key check (email = lower(email) and length(email) between 3 and 320)
);
create table if not exists public.study_records (
  user_id uuid not null references auth.users(id),
  record_key text not null,
  value jsonb,
  version bigint not null check (version > 0),
  updated_at bigint not null,
  primary key (user_id, record_key)
);
alter table public.study_accounts enable row level security;
alter table public.study_records enable row level security;
revoke all on public.study_accounts, public.study_records from public, anon, authenticated;

create or replace function public.study_sync(p_changes jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt()->>'email', ''));
  c jsonb;
  v_key text;
  v_version bigint;
  v_current bigint;
  v_keys text[] := '{}';
  v_conflicts text[] := '{}';
  v_records jsonb;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if v_uid is null then raise exception '请登录后同步' using errcode = '42501'; end if;
  if not exists (select 1 from public.study_accounts where email = v_email) then
    raise exception '此账号未启用同步，请使用自己的练习账号' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception '同步参数无效' using errcode = '22023';
  end if;
  if jsonb_array_length(p_changes) > 25 or octet_length(p_changes::text) > 3000000 then
    raise exception '同步批次过大' using errcode = '22023';
  end if;
  -- Serializes writes for one account; prevents two new records both claiming version 0.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  for c in select * from jsonb_array_elements(p_changes) loop
    v_key := c->>'key';
    if jsonb_typeof(c) <> 'object' or jsonb_typeof(c->'key') <> 'string' or v_key is null
       or length(v_key) > 179 or v_key !~ '^(settings|active|session:[A-Za-z0-9_-]+|favorite:[A-Za-z0-9_-]+|wrong:[A-Za-z0-9_-]+)$'
       or v_key = any(v_keys) or not (c ? 'value')
       or jsonb_typeof(c->'version') is distinct from 'number'
       or (c->>'version')::numeric < 0 or (c->>'version')::numeric > 9007199254740991
       or (c->>'version')::numeric <> trunc((c->>'version')::numeric)
       or octet_length((c->'value')::text) > 1700000 then
      raise exception '记录键、内容或版本无效' using errcode = '22023';
    end if;
    v_keys := array_append(v_keys, v_key);
    v_version := (c->>'version')::bigint;
    select version into v_current from public.study_records where user_id = v_uid and record_key = v_key;
    if coalesce(v_current, 0) <> v_version then v_conflicts := array_append(v_conflicts, v_key); end if;
  end loop;
  if cardinality(v_conflicts) = 0 then
    for c in select * from jsonb_array_elements(p_changes) loop
      insert into public.study_records(user_id, record_key, value, version, updated_at)
      values (v_uid, c->>'key', c->'value', (c->>'version')::bigint + 1, v_now)
      on conflict (user_id, record_key) do update
        set value = excluded.value, version = excluded.version, updated_at = excluded.updated_at;
    end loop;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('key', record_key, 'value', value,
    'version', version, 'updatedAt', updated_at) order by record_key), '[]'::jsonb)
    into v_records from public.study_records where user_id = v_uid;
  return jsonb_build_object('userId', v_uid::text, 'records', v_records,
    'conflicts', to_jsonb(v_conflicts), 'conflict', cardinality(v_conflicts) > 0);
end;
$$;
revoke all on function public.study_sync(jsonb) from public, anon;
grant execute on function public.study_sync(jsonb) to authenticated;
