-- Diário de Treino: esquema do banco (Supabase / Postgres)
-- Rode este arquivo inteiro uma vez no SQL Editor do projeto.

create table if not exists public.docs (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  collection text        not null,   -- 'plan', 'logs', 'feedback', 'media'
  id         text        not null,   -- 'current', '2026-11-05', ...
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, collection, id)
);

create index if not exists docs_collection_idx on public.docs (user_id, collection);

-- atualiza updated_at a cada escrita
create or replace function public.docs_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before insert or update on public.docs
  for each row execute function public.docs_touch();

-- segurança: cada usuário só enxerga e altera as próprias linhas
alter table public.docs enable row level security;

drop policy if exists "docs_own_select" on public.docs;
drop policy if exists "docs_own_insert" on public.docs;
drop policy if exists "docs_own_update" on public.docs;
drop policy if exists "docs_own_delete" on public.docs;

create policy "docs_own_select" on public.docs for select to authenticated using (user_id = auth.uid());
create policy "docs_own_insert" on public.docs for insert to authenticated with check (user_id = auth.uid());
create policy "docs_own_update" on public.docs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "docs_own_delete" on public.docs for delete to authenticated using (user_id = auth.uid());

-- sincronização em tempo real (a tela atualiza quando o Claude altera algo no banco)
do $$
begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null;
end $$;

-- visões práticas para histórico e para o Claude consultar
create or replace view public.v_treinos as
select
  d.user_id,
  d.id                                   as dia,
  d.data->>'workout'                     as treino,
  coalesce((d.data->>'done')::boolean, false) as concluido,
  d.data->>'note'                        as observacao,
  (select coalesce(sum((w->>'durSec')::int), 0) from jsonb_array_elements(coalesce(d.data->'watch','[]'::jsonb)) w) as segundos_relogio,
  (select coalesce(sum((w->>'kcal')::int), 0)   from jsonb_array_elements(coalesce(d.data->'watch','[]'::jsonb)) w) as kcal_relogio
from public.docs d
where d.collection = 'logs';

create or replace view public.v_series as
select
  d.user_id,
  d.id                          as dia,
  d.data->>'workout'            as treino,
  s.key                         as exercicio_id,
  t.ord::int                   as serie,
  nullif(t.val->>'kg','')::numeric   as kg,
  nullif(t.val->>'reps','')::numeric as reps
from public.docs d
cross join lateral jsonb_each(coalesce(d.data->'sets','{}'::jsonb)) s
cross join lateral jsonb_array_elements(s.value) with ordinality as t(val, ord)
where d.collection = 'logs';

alter view public.v_treinos set (security_invoker = true);
alter view public.v_series  set (security_invoker = true);
