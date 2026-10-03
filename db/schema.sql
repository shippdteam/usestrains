-- strains: database schema (PostgreSQL). Idempotent: safe to run more than once.

-- every wallet that uses Strains: its fuel (SOL for launches), fees owed to it and fees already paid
create table if not exists st_wallets (
  wallet text primary key,
  created_at timestamptz default now(),
  fuel_sol numeric default 0,
  deposited_sol numeric default 0,
  owed_sol numeric default 0,
  paid_sol numeric default 0,
  free_used boolean default false,
  last_action_ts bigint default 0
);

-- the agents
create table if not exists st_strains (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  status text default 'pending',               -- pending → alive → dead (or failed)
  slug text, name text, persona text, vibes jsonb default '[]'::jsonb,
  genome jsonb, avatar_url text,
  creator_wallet text,
  owners jsonb default '[]'::jsonb,            -- [{wallet, share}] who funds its launches and gets its coins' fees
  interval_min int default 240, dev_buy_sol numeric default 0, paused boolean default false,
  generation int default 0, parent_a uuid, parent_b uuid, bred_with jsonb default '[]'::jsonb, children int default 0,
  born_at timestamptz, died_at timestamptz, death_note text,
  next_launch_at timestamptz, last_launch_at timestamptz, launches int default 0, launch_lock_until timestamptz,
  fitness numeric default 0, form numeric, judge_avg numeric, market_h1 numeric default 0, rank int,
  fees_sol numeric default 0, vol_usd numeric default 0, best_mcap numeric default 0,
  paid_sol numeric default 0, fuel_paid_sol numeric default 0, pay_sig text, error text
);
create unique index if not exists st_strains_slug on st_strains (slug) where status <> 'failed';
create unique index if not exists st_strains_sig on st_strains (pay_sig) where pay_sig is not null;
create index if not exists st_strains_alive on st_strains (status, next_launch_at);
create index if not exists st_strains_creator on st_strains (creator_wallet);

-- the coins the agents launch
create table if not exists st_coins (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  strain_id uuid references st_strains(id),
  status text default 'concept',               -- concept → imaged → live (or failed)
  name text, ticker text, description text, image_idea text, image_url text,
  mint text, create_sig text, launched_at timestamptz, dev_buy_sol numeric default 0, charged jsonb,
  judge_score numeric, judge_note text, judged_at timestamptz,
  vol_h1 numeric default 0, vol_h24 numeric default 0, buys_h1 int default 0, mcap numeric default 0, ath_mcap numeric default 0,
  fees_sol numeric default 0,
  tokens_to text, tokens_sent boolean default false, tokens_sig text, tokens_sig_at timestamptz,
  lock_until timestamptz, attempts int default 0, error text
);
create unique index if not exists st_coins_mint on st_coins (mint) where mint is not null;
create index if not exists st_coins_strain on st_coins (strain_id, created_at desc);
create index if not exists st_coins_status on st_coins (status, created_at);

-- public feed: launches, births, deaths, verdicts, burns, payouts
create table if not exists st_events (
  id bigserial primary key,
  at timestamptz default now(),
  type text, strain_id uuid, coin_id uuid, text text, data jsonb
);
create index if not exists st_events_at on st_events (at desc);

create table if not exists st_deposits (sig text primary key, at timestamptz default now(), wallet text, sol numeric, kind text);
create table if not exists st_state (key text primary key, value jsonb);

alter table st_wallets enable row level security;
alter table st_strains enable row level security;
alter table st_coins enable row level security;
alter table st_events enable row level security;
alter table st_deposits enable row level security;
alter table st_state enable row level security;

-- money moves happen inside the database so two jobs can never double-spend the same fuel
create or replace function st_add_fuel(p_wallet text, p_sol numeric, p_deposit boolean default false) returns numeric language plpgsql as $$
declare v numeric;
begin
  insert into st_wallets (wallet) values (p_wallet) on conflict (wallet) do nothing;
  update st_wallets set fuel_sol = fuel_sol + p_sol, deposited_sol = deposited_sol + case when p_deposit then p_sol else 0 end
    where wallet = p_wallet returning fuel_sol into v;
  return v;
end $$;

-- charge p_sol split across owners by share; all or nothing. Returns true if charged.
create or replace function st_charge(p_owners jsonb, p_sol numeric) returns boolean language plpgsql as $$
declare o jsonb; short int;
begin
  perform 1 from st_wallets where wallet in (select x->>'wallet' from jsonb_array_elements(p_owners) x) for update;
  select count(*) into short from jsonb_array_elements(p_owners) x
    left join st_wallets w on w.wallet = x->>'wallet'
    where coalesce(w.fuel_sol, 0) < (x->>'share')::numeric * p_sol - 1e-9;
  if short > 0 then return false; end if;
  for o in select * from jsonb_array_elements(p_owners) loop
    update st_wallets set fuel_sol = fuel_sol - (o->>'share')::numeric * p_sol where wallet = o->>'wallet';
  end loop;
  return true;
end $$;

create or replace function st_add_owed(p_wallet text, p_sol numeric) returns void language plpgsql as $$
begin
  insert into st_wallets (wallet) values (p_wallet) on conflict (wallet) do nothing;
  update st_wallets set owed_sol = owed_sol + p_sol where wallet = p_wallet;
end $$;

create or replace function st_mark_paid(p_wallet text, p_sol numeric) returns void language plpgsql as $$
begin
  update st_wallets set owed_sol = greatest(0, owed_sol - p_sol), paid_sol = paid_sol + p_sol where wallet = p_wallet;
end $$;

-- public images (creatures and coin art)
insert into storage.buckets (id, name, public) values ('strains', 'strains', true) on conflict (id) do nothing;
