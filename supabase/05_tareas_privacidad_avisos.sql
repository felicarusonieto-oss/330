-- =====================================================================
--  330 - Tareas: cada usuario ve solo lo suyo (Felipe ve todo) y
--  aviso a Felipe cuando un usuario le carga una tarea a otro.
--  Ejecutar en Supabase > SQL Editor después de 04. Idempotente.
-- =====================================================================

-- Cuándo Felipe (admin) tomó conocimiento de la tarea. NULL = aviso pendiente.
alter table public.tareas add column if not exists aviso_admin_at timestamptz;
-- Las tareas que ya existían no generan aviso
update public.tareas set aviso_admin_at = coalesce(aviso_admin_at, now()) where aviso_admin_at is null;
create index if not exists tareas_aviso_admin_idx on public.tareas(created_at) where aviso_admin_at is null;

-- ¿Hace falta avisarle al admin? Solo si quien la carga no es admin y se la asigna a otra
-- persona que tampoco es admin.
create or replace function public.tarea_requiere_aviso(p_creador uuid, p_asignado uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_asignado is not null
     and p_asignado <> p_creador
     and not exists (select 1 from public.profiles where id = p_creador  and role = 'admin')
     and not exists (select 1 from public.profiles where id = p_asignado and role = 'admin');
$$;
revoke execute on function public.tarea_requiere_aviso(uuid, uuid) from public, anon;
grant  execute on function public.tarea_requiere_aviso(uuid, uuid) to authenticated;

create or replace function public.tareas_aviso_admin()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.aviso_admin_at := case when public.tarea_requiere_aviso(new.creado_por, new.asignado_a) then null else now() end;
  else
    if new.asignado_a is distinct from old.asignado_a and not public.is_admin() then
      -- reasignada por un usuario: nuevo aviso si corresponde
      new.aviso_admin_at := case when public.tarea_requiere_aviso(auth.uid(), new.asignado_a) then null else old.aviso_admin_at end;
    elsif not public.is_admin() then
      new.aviso_admin_at := old.aviso_admin_at;   -- solo el admin lo marca como leído
    end if;
  end if;
  return new;
end $$;
drop trigger if exists tareas_aviso_admin on public.tareas;
create trigger tareas_aviso_admin before insert or update on public.tareas
  for each row execute function public.tareas_aviso_admin();

-- Visibilidad: Felipe ve todo; cada usuario ve las que le asignaron y las que cargó él
drop policy if exists tareas_select on public.tareas;
create policy tareas_select on public.tareas for select to authenticated
  using (public.is_admin() or asignado_a = auth.uid() or creado_por = auth.uid());

notify pgrst, 'reload schema';
