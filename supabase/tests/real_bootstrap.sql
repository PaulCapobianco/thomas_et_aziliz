-- LOCAL DISPOSABLE STACK ONLY (scripts/real-stack.sh): roles and auth helpers that Supabase provides itself.
-- Never run this on a Supabase project.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password 'pw';
create role supabase_storage_admin login createrole password 'pw';
grant anon, authenticated, service_role to authenticator, supabase_storage_admin;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(current_setting('request.jwt.claim.role', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')) $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role, supabase_storage_admin;
grant usage on schema public to anon, authenticated, service_role, supabase_storage_admin;
grant create on schema public to supabase_storage_admin;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
grant all on database wedding_real to supabase_storage_admin;

-- Supabase grants these on the storage schema it creates; RLS policies (0003) restrict the rows.
-- (Applied by real-stack.sh once the Storage API has created its schema, see real_after_storage.sql.)
