-- =====================================================================
--  330 - Tareas: pestaña General (todos ven todas las tareas) + "La vi"
--  Ejecutar en Supabase > SQL Editor después de 03. Idempotente.
-- =====================================================================

-- Cuándo se asignó a la persona actual, y cuándo la vio
alter table public.tareas add column if not exists asignada_at timestamptz;
alter table public.tareas add column if not exists visto_at    timestamptz;
alter table public.tareas add column if not exists visto_por   uuid references public.profiles(id) on delete set null;
update public.tareas set asignada_at = created_at where asignada_at is null;
alter table public.tareas alter column asignada_at set default now();
create index if not exists tareas_sin_ver_idx on public.tareas(asignado_a) where visto_at is null;

-- Reglas automáticas:
--  * el creador y la fecha de publicación no se cambian
--  * si se asigna a otra persona, vuelve a quedar "sin ver" y el reloj arranca de nuevo
--  * solo la persona asignada puede marcarla como vista (con la hora del servidor)
--  * una vez vista no se puede "des-ver"
--  * si te la asignás a vos mismo, queda vista
create or replace function public.tareas_before_write()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.asignada_at := now();
    if new.asignado_a is not null and new.asignado_a = auth.uid() then
      new.visto_at := now(); new.visto_por := auth.uid();
    else
      new.visto_at := null; new.visto_por := null;
    end if;
  else
    new.creado_por  := old.creado_por;
    new.created_at  := old.created_at;
    new.asignada_at := old.asignada_at;
    if new.asignado_a is distinct from old.asignado_a then
      new.asignada_at := now();
      if new.asignado_a is not null and new.asignado_a = auth.uid() then
        new.visto_at := now(); new.visto_por := auth.uid();
      else
        new.visto_at := null; new.visto_por := null;
      end if;
    elsif old.visto_at is null and new.visto_at is not null then
      if auth.uid() is distinct from new.asignado_a then
        raise exception 'Solo la persona asignada puede marcar la tarea como vista';
      end if;
      new.visto_at := now(); new.visto_por := auth.uid();
    else
      new.visto_at := old.visto_at; new.visto_por := old.visto_por;
    end if;
    -- terminarla también cuenta como vista
    if new.estado = 'hecha' and new.visto_at is null and auth.uid() = new.asignado_a then
      new.visto_at := now(); new.visto_por := auth.uid();
    end if;
  end if;

  if new.estado = 'hecha' and (tg_op = 'INSERT' or old.estado <> 'hecha') then
    new.completada_at := now();
  elsif new.estado <> 'hecha' then
    new.completada_at := null;
  end if;
  return new;
end $$;

-- Pestaña General: todos los usuarios ven todas las tareas
drop policy if exists tareas_select on public.tareas;
create policy tareas_select on public.tareas for select to authenticated
  using (true);

notify pgrst, 'reload schema';
