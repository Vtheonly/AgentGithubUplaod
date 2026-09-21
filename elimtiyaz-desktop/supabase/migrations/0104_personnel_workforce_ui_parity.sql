-- 0104_personnel_workforce_ui_parity.sql
-- Personnel UI/backend parity:
-- 1. Financial officers may review leave/reimbursement requests, matching UI.
-- 2. Workers can answer clarification requests through an ownership-checked RPC
--    without receiving broad UPDATE rights on leave_requests.

drop policy if exists leave_requests_select on public.leave_requests;
create policy leave_requests_select
on public.leave_requests
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    public.has_any_role(array[
      'super_admin',
      'financial_officer',
      'support_staff',
      'manager'
    ]::text[])
    or personnel_id in (
      select p.id
      from public.personnel p
      where p.tenant_id = public.current_tenant_id()
        and p.user_id = public.current_user_profile_id()
        and p.deleted_at is null
    )
  )
);

drop policy if exists leave_requests_manager_update on public.leave_requests;
create policy leave_requests_manager_update
on public.leave_requests
for update
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and public.has_any_role(array[
    'super_admin',
    'financial_officer',
    'manager'
  ]::text[])
)
with check (
  tenant_id = public.current_tenant_id()
  and public.has_any_role(array[
    'super_admin',
    'financial_officer',
    'manager'
  ]::text[])
);

create or replace function public.respond_leave_clarification(
  p_request_id uuid,
  p_response text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
  v_tenant_id uuid;
  v_status text;
begin
  v_profile_id := public.current_user_profile_id();
  v_tenant_id := public.current_tenant_id();

  if v_profile_id is null or v_tenant_id is null then
    raise exception 'Authentication context is required';
  end if;

  if btrim(coalesce(p_response, '')) = '' then
    raise exception 'A clarification response is required';
  end if;

  select lr.status
    into v_status
  from public.leave_requests lr
  join public.personnel p
    on p.id = lr.personnel_id
   and p.tenant_id = lr.tenant_id
  where lr.id = p_request_id
    and lr.tenant_id = v_tenant_id
    and p.user_id = v_profile_id
    and p.deleted_at is null
  for update;

  if not found then
    raise exception 'Leave request not found or not owned by the current user';
  end if;

  if v_status <> 'clarification_requested' then
    raise exception 'Leave request is not awaiting clarification response';
  end if;

  update public.leave_requests
  set
    status = 'pending',
    clarification_response = btrim(p_response),
    updated_at = now()
  where id = p_request_id
    and tenant_id = v_tenant_id;

  return p_request_id;
end;
$$;

revoke all on function public.respond_leave_clarification(uuid, text) from public;
revoke execute on function public.respond_leave_clarification(uuid, text) from anon;
grant execute on function public.respond_leave_clarification(uuid, text) to authenticated;
