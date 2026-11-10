-- Keepalive専用の軽量RPC。
-- anonへテーブル権限を戻さず、PostgREST経由でDBクエリだけを実行する。
create or replace function public.keepalive_ping()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select true;
$$;

revoke all on function public.keepalive_ping() from public;
revoke all on function public.keepalive_ping() from authenticated;
grant execute on function public.keepalive_ping() to anon;

comment on function public.keepalive_ping() is
  'Anonymous no-data RPC used only by the GitHub Actions Supabase keepalive job.';
