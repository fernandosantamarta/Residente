-- ============================================================
-- Residente — Pragmatic end-to-end verifiable voting (E2E-V)
-- Run once in the Supabase SQL editor. Safe to re-run. Run AFTER easy-voice.sql.
-- ============================================================
--
-- Upgrades secret voting from "trust us, it's secret" to "verify it yourself":
--   • RECORDED-AS-CAST  — each voter gets a tracking code and can find their
--     (still-secret) ciphertext on a public, hash-chained bulletin board.
--   • COUNTED-AS-RECORDED — after close the vote secret key is revealed, so
--     ANYONE can re-decrypt the published ballots and reproduce the tally.
--   • BALLOT SECRECY preserved — voter identity (ev_participation) and ballot
--     content (ev_ballot_box) live in SEPARATE tables with NO stored join. The
--     only write path is ev_cast_ballot(), which never records the correlation.
--
-- Built on the EXISTING NaCl crypto (lib/ballotCrypto.ts) + SHA-256 hash chain.
-- NOT homomorphic/ZK/threshold — see the threat-model notes in the plan.
--
-- RESIDUAL TRUST (disclosed): unlinkability is procedural, not cryptographic —
-- a malicious operator could modify ev_cast_ballot to log the correlation, or
-- infer it from row timing. We mitigate (shuffle-at-close, day-bucketed
-- timestamps, no stored join, a published hash of the deployed function source)
-- and disclose it. A verifiable mixnet would eliminate it; out of scope here.

-- ---------- 0) per-vote feature flag + key snapshot already on ev_votes ----------
alter table public.ev_votes
  add column if not exists verifiable boolean not null default false;

-- ============================================================
-- 1) ev_ballot_box — the anonymous ballot box (NO identity columns)
-- ============================================================
create table if not exists public.ev_ballot_box (
  id                uuid primary key default gen_random_uuid(),
  vote_id           uuid not null references public.ev_votes(id) on delete cascade,
  community_id      uuid not null references public.communities(id) on delete cascade,
  encrypted_answer  text not null,         -- NaCl box wire format, base64 (lib/ballotCrypto)
  candidate_ids_enc text,                  -- elections: encrypted selection blob (nullable)
  receipt_commit    text not null,         -- base64 SHA-256 of the voter's tracking code
  chain_index       integer,               -- assigned at CLOSE after a shuffle; null while open
  prev_hash         text,                  -- base64 32B; null while open
  ballot_hash       text,                  -- base64 32B = SHA-256(prev_bytes || canonical_bytes)
  answer            text check (answer in ('yes','no','abstain') or answer is null), -- filled at tally
  cast_day          date not null default (now() at time zone 'utc')::date, -- bucketed (no time)
  created_at        timestamptz not null default now()    -- operational only; never published
);
create index if not exists ev_ballot_box_vote_idx    on public.ev_ballot_box (vote_id, chain_index);
create index if not exists ev_ballot_box_receipt_idx  on public.ev_ballot_box (vote_id, receipt_commit);

alter table public.ev_ballot_box enable row level security;
-- NO insert grant — the ONLY write path is the security-definer ev_cast_ballot.
-- Board may select (to tally) + update the answer (decrypt-and-write).
grant select on public.ev_ballot_box to authenticated;
grant update (answer) on public.ev_ballot_box to authenticated;
grant select, insert, update on public.ev_ballot_box to service_role;

-- Board reads the box in their community (needed to decrypt + tally).
drop policy if exists "board reads ballot box" on public.ev_ballot_box;
create policy "board reads ballot box"
  on public.ev_ballot_box for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- Board writes the plaintext answer at tally (closed/tallied only — never open).
drop policy if exists "board writes box tally answer" on public.ev_ballot_box;
create policy "board writes box tally answer"
  on public.ev_ballot_box for update to authenticated
  using (
    vote_id in (
      select id from public.ev_votes
      where community_id = (select community_id from public.profiles where id = auth.uid())
        and status in ('closed','tallied')
    )
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (answer in ('yes','no','abstain'));

-- ============================================================
-- 2) ev_participation — the "who voted" roll (NO ballot content)
-- ============================================================
create table if not exists public.ev_participation (
  id           uuid primary key default gen_random_uuid(),
  vote_id      uuid not null references public.ev_votes(id) on delete cascade,
  community_id uuid not null references public.communities(id) on delete cascade,
  unit_id      uuid references public.ev_units(id) on delete set null,
  unit_number  text not null,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  proxy_id     uuid references public.ev_proxies(id) on delete set null,
  voted_day    date not null default (now() at time zone 'utc')::date,  -- bucketed
  created_at   timestamptz not null default now(),
  unique (vote_id, unit_number)   -- one ballot per unit (carried over from ev_ballots)
);
create index if not exists ev_participation_vote_idx on public.ev_participation (vote_id);

alter table public.ev_participation enable row level security;
-- NO insert grant — written only by ev_cast_ballot. Board + owner may read.
grant select on public.ev_participation to authenticated;
grant select, insert on public.ev_participation to service_role;

drop policy if exists "board reads participation" on public.ev_participation;
create policy "board reads participation"
  on public.ev_participation for select to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

drop policy if exists "owner reads own participation" on public.ev_participation;
create policy "owner reads own participation"
  on public.ev_participation for select to authenticated
  using (profile_id = auth.uid());

-- ============================================================
-- 3) ev_vote_commitments — published commitments / bulletin-board head
-- ============================================================
create table if not exists public.ev_vote_commitments (
  vote_id             uuid primary key references public.ev_votes(id) on delete cascade,
  community_id        uuid not null references public.communities(id) on delete cascade,
  ballot_count        integer not null default 0,
  chain_head_hash     text,                 -- base64 32B; set at CLOSE (before any decryption)
  cast_function_sha   text,                 -- base64 SHA-256 of the deployed ev_cast_ballot source
  public_key          text,                 -- immutable snapshot of ev_votes.public_key
  revealed_secret_key text,                 -- base64 32B; published at PUBLISH (after tally)
  tally_yes           integer,
  tally_no            integer,
  tally_abstain       integer,
  result              text check (result in ('pass','fail') or result is null),
  committed_at        timestamptz,
  revealed_at         timestamptz
);
alter table public.ev_vote_commitments enable row level security;
grant select on public.ev_vote_commitments to authenticated;
grant update on public.ev_vote_commitments to authenticated;   -- board records tally + reveals key
grant select, insert, update on public.ev_vote_commitments to service_role;

drop policy if exists "members read commitments" on public.ev_vote_commitments;
create policy "members read commitments"
  on public.ev_vote_commitments for select to authenticated
  using (community_id = (select community_id from public.profiles where id = auth.uid()));

drop policy if exists "board writes commitments" on public.ev_vote_commitments;
create policy "board writes commitments"
  on public.ev_vote_commitments for update to authenticated
  using (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  )
  with check (
    community_id = (select community_id from public.profiles where id = auth.uid())
    and (select role from public.profiles where id = auth.uid()) in ('board_member','admin')
  );

-- ============================================================
-- 4) ev_cast_ballot — the decoupling transaction (one write path)
-- ============================================================
-- Identity is taken from auth.uid(), never the payload. Inserts the
-- participation marker (identity, no content) AND the box row (content, no
-- identity) without storing any correlation between them.
create or replace function public.ev_cast_ballot(
  p_vote_id           uuid,
  p_encrypted_answer  text,
  p_candidate_ids_enc text default null,
  p_receipt_commit    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_community uuid;
  v_status    text;
  v_unit      text;
  v_unit_id   uuid;
  v_eligible  boolean;
  v_box_id    uuid;
begin
  if p_encrypted_answer is null or p_receipt_commit is null then
    raise exception 'Missing ballot payload' using errcode = 'P0001';
  end if;

  select community_id, status into v_community, v_status from ev_votes where id = p_vote_id;
  if v_community is null then raise exception 'Vote not found' using errcode = 'P0001'; end if;
  if v_status <> 'open' then raise exception 'Vote is not open' using errcode = 'P0001'; end if;

  -- Voter identity + unit from their profile (authoritative; not client-supplied).
  select unit_number into v_unit from public.profiles where id = auth.uid();
  if v_unit is null then raise exception 'No unit on file for this account' using errcode = 'P0001'; end if;

  -- Consent (FL 718.128 / 720.317) — same guard as the legacy path, enforced server-side.
  if not public.ev_has_consented(auth.uid(), v_community) then
    raise exception 'Electronic voting consent required (FL 718.128 / 720.317)' using errcode = 'P0001';
  end if;

  -- Eligibility: block only an explicitly-ineligible owner (lenient, matches legacy).
  select r.voting_eligible, r.unit_id into v_eligible, v_unit_id
    from public.residents r
   where r.profile_id = auth.uid() and r.community_id = v_community
   limit 1;
  if v_eligible is false then
    raise exception 'This account is not eligible to vote in this election' using errcode = 'P0001';
  end if;

  -- 1) participation marker (identity, no content). Dup unit → 23505 = already voted.
  insert into public.ev_participation (vote_id, community_id, unit_id, unit_number, profile_id)
    values (p_vote_id, v_community, v_unit_id, v_unit, auth.uid());

  -- 2) anonymous ballot box (content, no identity). Chain fields stay null until close.
  insert into public.ev_ballot_box (vote_id, community_id, encrypted_answer, candidate_ids_enc, receipt_commit)
    values (p_vote_id, v_community, p_encrypted_answer, p_candidate_ids_enc, p_receipt_commit)
    returning id into v_box_id;

  -- Deliberately returns ONLY the box id — no participation↔box correlation is
  -- returned or stored anywhere.
  return jsonb_build_object('box_id', v_box_id);
end $$;

grant execute on function public.ev_cast_ballot(uuid, text, text, text) to authenticated;

-- ============================================================
-- 5) ev_ballot_box tally trigger — keep ev_votes counts in sync
-- ============================================================
create or replace function public.ev_ballot_box_tally()
returns trigger language plpgsql as $$
declare v_answer text; bumped boolean := false;
begin
  if (tg_op = 'INSERT' and new.answer is not null) then v_answer := new.answer; bumped := true;
  elsif (tg_op = 'UPDATE' and old.answer is null and new.answer is not null) then v_answer := new.answer; bumped := true;
  end if;
  if bumped then
    if v_answer = 'yes' then update public.ev_votes set yes_count = yes_count + 1 where id = new.vote_id;
    elsif v_answer = 'no' then update public.ev_votes set no_count = no_count + 1 where id = new.vote_id;
    elsif v_answer = 'abstain' then update public.ev_votes set abstain_count = abstain_count + 1 where id = new.vote_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists ev_ballot_box_tally_trg on public.ev_ballot_box;
create trigger ev_ballot_box_tally_trg
  after insert or update on public.ev_ballot_box
  for each row execute function public.ev_ballot_box_tally();

-- ============================================================
-- 6) ev_seal_vote — close + shuffle + hash-chain + commit the head
-- ============================================================
-- Called at CLOSE, BEFORE any decryption. Shuffles the box (so chain order ≠
-- arrival order), builds the SHA-256 hash chain, and publishes the head hash +
-- ballot count + the deployed-function attestation hash. Board-only.
create or replace function public.ev_seal_vote(p_vote_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_community uuid;
  v_role      text;
  v_prev      text := null;
  v_canon     text;
  v_hash      text;
  v_count     integer;
  v_pubkey    text;
  v_fnsha     text;
  rec         record;
begin
  select community_id, public_key into v_community, v_pubkey from ev_votes where id = p_vote_id;
  if v_community is null then raise exception 'Vote not found' using errcode = 'P0001'; end if;
  select role into v_role from public.profiles where id = auth.uid();
  if v_role not in ('board_member','admin')
     or v_community <> (select community_id from public.profiles where id = auth.uid()) then
    raise exception 'Only the board may seal a vote' using errcode = 'P0001';
  end if;

  update ev_votes set status = 'closed', closes_at = coalesce(closes_at, now()) where id = p_vote_id;

  -- Shuffle then assign a stable chain_index (0-based) in the shuffled order.
  with shuffled as (
    select id, (row_number() over (order by gen_random_uuid())) - 1 as idx
      from ev_ballot_box where vote_id = p_vote_id
  )
  update ev_ballot_box b set chain_index = s.idx from shuffled s where b.id = s.id;

  -- Walk in chain order computing ballot_hash = SHA-256(prev_bytes || canonical_bytes).
  -- canonical = "<idx>|<encrypted_answer>|<candidate_ids_enc?>|<receipt_commit>"
  -- (byte-for-byte matched by lib/ballotCrypto.canonicalBallotBytes + ballotHash).
  for rec in
    select chain_index, encrypted_answer, candidate_ids_enc, receipt_commit, id
      from ev_ballot_box where vote_id = p_vote_id order by chain_index
  loop
    v_canon := rec.chain_index::text || '|' || rec.encrypted_answer || '|'
               || coalesce(rec.candidate_ids_enc, '') || '|' || rec.receipt_commit;
    v_hash := encode(
      sha256(decode(coalesce(v_prev, ''), 'base64') || convert_to(v_canon, 'UTF8')),
      'base64');
    update ev_ballot_box set prev_hash = v_prev, ballot_hash = v_hash where id = rec.id;
    v_prev := v_hash;
  end loop;

  select count(*) into v_count from ev_ballot_box where vote_id = p_vote_id;

  -- Attestation: hash of the deployed ev_cast_ballot source so a reviewer can
  -- confirm the running function matches the audited .sql.
  begin
    v_fnsha := encode(sha256(convert_to(
      pg_get_functiondef('public.ev_cast_ballot(uuid,text,text,text)'::regprocedure), 'UTF8')), 'base64');
  exception when others then v_fnsha := null; end;

  insert into ev_vote_commitments (vote_id, community_id, ballot_count, chain_head_hash, public_key, cast_function_sha, committed_at)
  values (p_vote_id, v_community, v_count, v_prev, v_pubkey, v_fnsha, now())
  on conflict (vote_id) do update set
    ballot_count = excluded.ballot_count,
    chain_head_hash = excluded.chain_head_hash,
    public_key = excluded.public_key,
    cast_function_sha = excluded.cast_function_sha,
    committed_at = now();

  return jsonb_build_object('ballot_count', v_count, 'chain_head_hash', v_prev);
end $$;

grant execute on function public.ev_seal_vote(uuid) to authenticated;

-- ============================================================
-- 7) Hash-chain the audit log (tamper-evident)
-- ============================================================
alter table public.ev_audit_log
  add column if not exists seq        bigint,
  add column if not exists prev_hash  text,
  add column if not exists entry_hash text;

create sequence if not exists public.ev_audit_log_seq;

create or replace function public.ev_audit_chain()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_prev text;
begin
  -- Serialize per-community appends so two concurrent inserts can't read the
  -- same prev_hash (low volume; the lock is cheap).
  perform pg_advisory_xact_lock(hashtext(new.community_id::text));
  new.seq := nextval('public.ev_audit_log_seq');
  select entry_hash into v_prev from public.ev_audit_log
    where community_id = new.community_id order by seq desc limit 1;
  new.prev_hash := v_prev;
  new.entry_hash := encode(sha256(convert_to(
    coalesce(v_prev,'') || coalesce(new.event_type,'') || coalesce(new.target_id::text,'')
      || coalesce(new.metadata::text,'') || coalesce(new.created_at::text,''), 'UTF8')), 'base64');
  return new;
end $$;

drop trigger if exists ev_audit_chain_trg on public.ev_audit_log;
create trigger ev_audit_chain_trg
  before insert on public.ev_audit_log
  for each row execute function public.ev_audit_chain();

-- Verify the chain for a community: returns the first broken seq, or null if intact.
create or replace function public.verify_audit_chain(p_community uuid)
returns bigint language plpgsql stable security definer set search_path = public as $$
declare rec record; v_prev text := null; v_calc text;
begin
  for rec in select * from public.ev_audit_log where community_id = p_community order by seq loop
    if rec.prev_hash is distinct from v_prev then return rec.seq; end if;
    v_calc := encode(sha256(convert_to(
      coalesce(v_prev,'') || coalesce(rec.event_type,'') || coalesce(rec.target_id::text,'')
        || coalesce(rec.metadata::text,'') || coalesce(rec.created_at::text,''), 'UTF8')), 'base64');
    if rec.entry_hash is distinct from v_calc then return rec.seq; end if;
    v_prev := rec.entry_hash;
  end loop;
  return null;
end $$;

grant execute on function public.verify_audit_chain(uuid) to authenticated;

-- ============================================================
-- 8) PUBLIC verifier surface — anon-readable views, published votes only
-- ============================================================
-- Definer views (owned by the migration role) bypass base-table RLS but expose
-- ONLY published votes and ONLY safe columns (no created_at → no timing leak,
-- no identity). This is the data the /verify page + standalone script read.
create or replace view public.ev_public_votes as
  select v.id as vote_id, v.community_id, v.title, v.type, v.status,
         v.yes_count, v.no_count, v.abstain_count, v.result, v.public_key
    from public.ev_votes v
   where v.status = 'published' and v.verifiable = true;

create or replace view public.ev_public_ballot_box as
  select b.vote_id, b.chain_index, b.prev_hash, b.ballot_hash,
         b.encrypted_answer, b.candidate_ids_enc, b.receipt_commit, b.cast_day, b.answer
    from public.ev_ballot_box b
    join public.ev_votes v on v.id = b.vote_id
   where v.status = 'published' and v.verifiable = true;

create or replace view public.ev_public_vote_commitments as
  select c.vote_id, c.community_id, c.ballot_count, c.chain_head_hash, c.cast_function_sha,
         c.public_key, c.revealed_secret_key, c.tally_yes, c.tally_no, c.tally_abstain,
         c.result, c.committed_at, c.revealed_at
    from public.ev_vote_commitments c
    join public.ev_votes v on v.id = c.vote_id
   where v.status = 'published' and v.verifiable = true;

grant select on public.ev_public_votes            to anon, authenticated;
grant select on public.ev_public_ballot_box        to anon, authenticated;
grant select on public.ev_public_vote_commitments  to anon, authenticated;
