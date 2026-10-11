-- LOCAL DISPOSABLE STACK ONLY: what Supabase's own image setup grants on the schema the Storage API creates.
grant usage on schema storage to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
grant all on all functions in schema storage to anon, authenticated, service_role;
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'admin@example.test'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'invite@example.test')
  on conflict do nothing;
insert into public.admin_users (user_id) values ('aaaaaaaa-0000-0000-0000-000000000001') on conflict do nothing;
