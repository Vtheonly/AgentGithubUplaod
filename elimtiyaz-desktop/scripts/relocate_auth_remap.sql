-- relocate_auth_remap.sql — T-574 lane (d): the §A.4.3.3b email-match remap,
-- shipped schema-true against the consolidated baseline (0001).
--
-- WHAT THIS IS: the SUPABASE-RELOCATION-AND-RELOAD-GUIDE §A.4.3.3b "remap by
-- email" pass — the fallback sub-path used when auth users could NOT be
-- re-created with their original UUIDs (Path 2's worst case, 3b): fresh users
-- get new UUIDs, and the public linkage tables are re-pointed at them by
-- lower()-cased email match. Running the APPLY twice converges to the same
-- state (idempotent by construction: the second run writes the same ids).
--
-- THE C-28 SCHEMA-TRUE CORRECTION: the guide's third leg
--   (`update students s set auth_user_id = au.id … where lower(au.email) =
--    lower(s.email)`) references `s.email` — the consolidated baseline's
--    `students` table (0001:2642-2670) has NO email column. The shipped remap
--    email-matches `user_profiles` + `parents` ONLY; students re-bind via the
--    ACTIVATION flow (the linkage map's own design — the 0047 rebind guard
--    exists for exactly this), and every other auth_user_id-bearing surface is
--    reported by the DRY-RUN as a dangling census instead of blindly rewritten.
--
-- THE TWO SECTIONS: the DRY-RUN (read-only, the T-446 BEGIN/ROLLBACK-safe
-- convention — submitted through scripts/relocate-auth.mjs which strips the
-- trailing ROLLBACK per the §11.1/T-446 wire convention) and the APPLY
-- (BEGIN…COMMIT, double-fenced behind `--apply --confirm REMAP`). The
-- post-verify step re-runs the DRY-RUN: "N rows updated" is NOT convergence —
-- rows_would_change must read 0 on both remap surfaces afterwards.
--
-- THE PATH-2 HARD FLAGS (the runbook §A.0/blocker 7): ARCH-029 (restore never
-- replays to the live store) + BUG-061/BUG-072 (the integrity reads run
-- unscoped+uncapped) must be FIXED before the Path-2 verification gates rely
-- on them — this script's report carries the reminder so the operator cannot
-- run those gates on the unfixed surfaces unknowingly.
--
-- Submitted through the Management-API SQL wire (the §11.1 convention) at the
-- owner's cutover window ONLY (OPS-015/G2: zero live traffic otherwise).

-- >>> REMAP DRY-RUN (read-only) >>>
begin;

-- One row per linkage surface of the 7-surface map (RELOAD-GUIDE Layer 3.1).
-- Remap surfaces (email-matched): user_profiles, parents.
-- Report-only surfaces (re-bind via their designed flows, never SQL-rewritten):
-- students (no email column — C-28), activation_codes, personnel, and the
-- web-signup approval queue. The last row is the duplicate-email hazard.
select 'user_profiles' as surface, 'remap' as mode,
       (select count(*) from public.user_profiles) as rows_total,
       (select count(*) from public.user_profiles up where up.email is not null) as rows_with_email,
       (select count(*) from public.user_profiles up
          where exists (select 1 from auth.users au where lower(au.email) = lower(up.email))) as rows_matched,
       (select count(*) from public.user_profiles up
          where exists (select 1 from auth.users au where lower(au.email) = lower(up.email))
            and not exists (select 1 from auth.users au
                              where lower(au.email) = lower(up.email) and au.id = up.auth_user_id)) as rows_would_change,
       (select count(*) from public.user_profiles up
          where exists (select 1 from auth.users au
                          where lower(au.email) = lower(up.email) and au.id = up.auth_user_id)) as rows_already_correct,
       (select count(*) from public.user_profiles up
          where up.email is not null
            and not exists (select 1 from auth.users au where lower(au.email) = lower(up.email))) as rows_unmatched,
       (select count(*) from public.user_profiles up
          where not exists (select 1 from auth.users au where au.id = up.auth_user_id)) as rows_dangling
union all
select 'parents', 'remap',
       (select count(*) from public.parents),
       (select count(*) from public.parents p where p.email is not null),
       (select count(*) from public.parents p
          where exists (select 1 from auth.users au where lower(au.email) = lower(p.email))),
       (select count(*) from public.parents p
          where exists (select 1 from auth.users au where lower(au.email) = lower(p.email))
            and not exists (select 1 from auth.users au
                              where lower(au.email) = lower(p.email) and au.id = p.auth_user_id)),
       (select count(*) from public.parents p
          where exists (select 1 from auth.users au
                          where lower(au.email) = lower(p.email) and au.id = p.auth_user_id)),
       (select count(*) from public.parents p
          where p.email is not null
            and not exists (select 1 from auth.users au where lower(au.email) = lower(p.email))),
       (select count(*) from public.parents p
          where p.auth_user_id is not null
            and not exists (select 1 from auth.users au where au.id = p.auth_user_id))
union all
select 'students', 'report',
       (select count(*) from public.students),
       0::bigint,  -- students has NO email column in the consolidated baseline (C-28) — email-match is impossible by design
       0::bigint,
       0::bigint,
       0::bigint,
       0::bigint,
       (select count(*) from public.students s
          where s.auth_user_id is not null
            and not exists (select 1 from auth.users au where au.id = s.auth_user_id))
union all
select 'activation_codes', 'report',
       (select count(*) from public.activation_codes),
       0::bigint,
       0::bigint,
       0::bigint,
       0::bigint,
       0::bigint,
       (select count(*) from public.activation_codes ac
          where ac.bound_to_auth_user_id is not null
            and not exists (select 1 from auth.users au where au.id = ac.bound_to_auth_user_id))
union all
select 'personnel', 'report',
       (select count(*) from public.personnel),
       0::bigint,
       0::bigint,
       0::bigint,
       0::bigint,
       0::bigint,
       (select count(*) from public.personnel pe
          where pe.user_id is not null
            and not exists (select 1 from auth.users au where au.id = pe.user_id))
union all
select 'account_approval_requests', 'report',
       (select count(*) from public.account_approval_requests),
       0::bigint,
       0::bigint,
       0::bigint,
       0::bigint,
       0::bigint,
       (select count(*) from public.account_approval_requests ar
          where ar.auth_user_id is not null
            and not exists (select 1 from auth.users au where au.id = ar.auth_user_id))
union all
select 'auth_users_dupes', 'hazard',
       (select count(*) from auth.users au
          where exists (select 1 from auth.users au2
                          where lower(au2.email) = lower(au.email) and au2.id <> au.id)),
       0::bigint,
       (select count(*) from (
          select lower(email) as lowered from auth.users where email is not null
          group by lower(email) having count(*) > 1) as dupes),
       0::bigint,
       0::bigint,
       0::bigint,
       0::bigint;

rollback;
-- <<< REMAP DRY-RUN <<<

-- >>> REMAP APPLY (idempotent email-match updates — submit ONLY with --apply --confirm REMAP) >>>
begin;

-- §A.4.3.3b, legs 1 and 2, verbatim modulo the public. qualification.
-- Idempotent by construction: re-running writes the same matched ids again.
update public.user_profiles up set auth_user_id = au.id
  from auth.users au where lower(au.email) = lower(up.email);

update public.parents p set auth_user_id = au.id
  from auth.users au where lower(au.email) = lower(p.email);

-- NOTE (C-28): the guide's third leg (students, by s.email) is DELIBERATELY
-- absent — the consolidated baseline's students table carries no email column.
-- Students re-bind via the activation flow (bind_activation_code + the 0047
-- rebind guard), NOT via blind SQL.
--
-- NOTE (design): activation_codes, personnel and account_approval_requests are
-- never SQL-rewritten here either — they re-bind through their designed flows
-- (activation codes; admin_create_user_account / the create-user-account EF;
-- re-signup). The DRY-RUN section above reports their dangling counts.

commit;
-- <<< REMAP APPLY <<<
