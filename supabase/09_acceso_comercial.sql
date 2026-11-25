-- =====================================================================
--  330 - Compras y Ventas: solo los usuarios con "acceso comercial"
--  (felipe y andrea). Ver y editar. Monotributo y Gastos siguen solo admin.
--  Ejecutar después de 08. Idempotente.
-- =====================================================================
alter table public.profiles add column if not exists acceso_comercial boolean not null default false;
update public.profiles set acceso_comercial = true where username in ('felipe', 'andrea');

create or replace function public.is_comercial()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and active and acceso_comercial);
$$;
revoke execute on function public.is_comercial() from public, anon;
grant  execute on function public.is_comercial() to authenticated;

-- Ventas y Compras: ver y editar solo con acceso comercial
drop policy if exists ventas_admin on public.ventas;
drop policy if exists ventas_comercial on public.ventas;
create policy ventas_comercial on public.ventas for all to authenticated
  using (public.is_comercial()) with check (public.is_comercial());

drop policy if exists compras_admin on public.compras;
drop policy if exists compras_comercial on public.compras;
create policy compras_comercial on public.compras for all to authenticated
  using (public.is_comercial()) with check (public.is_comercial());

-- Guardar venta (con sus formas de pago y compras asociadas)
create or replace function public.guardar_venta(p jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint := nullif(p->>'id', '')::bigint;
  ids  bigint[] := coalesce(array(select (x)::bigint from jsonb_array_elements_text(coalesce(p->'compra_ids', '[]'::jsonb)) x), '{}');
begin
  if not public.is_comercial() then raise exception 'No tenés acceso a Ventas'; end if;
  if jsonb_typeof(coalesce(p->'pagos', '[]'::jsonb)) <> 'array' then raise exception 'Pagos inválidos'; end if;

  if v_id is null then
    insert into public.ventas (fecha, cliente, descripcion, precio_final, vendedor, pagos)
    values (coalesce(nullif(p->>'fecha', '')::date, current_date),
            coalesce(trim(p->>'cliente'), ''), coalesce(trim(p->>'descripcion'), ''),
            coalesce(nullif(p->>'precio_final', '')::numeric, 0),
            coalesce(p->>'vendedor', ''), coalesce(p->'pagos', '[]'::jsonb))
    returning id into v_id;
  else
    update public.ventas
       set fecha        = coalesce(nullif(p->>'fecha', '')::date, fecha),
           cliente      = coalesce(trim(p->>'cliente'), ''),
           descripcion  = coalesce(trim(p->>'descripcion'), ''),
           precio_final = coalesce(nullif(p->>'precio_final', '')::numeric, 0),
           vendedor     = coalesce(p->>'vendedor', ''),
           pagos        = coalesce(p->'pagos', '[]'::jsonb)
     where id = v_id;
    if not found then raise exception 'La venta no existe'; end if;
  end if;

  update public.compras set venta_id = v_id where id = any(ids);
  update public.compras set venta_id = null where venta_id = v_id and not (id = any(ids));
  return v_id;
end $$;

-- La función vieja (ya no la usa la app) queda solo para el admin
-- ADMIN: dar o quitar el acceso a Compras y Ventas
create or replace function public.admin_set_comercial(p_user_id uuid, p_value boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo el administrador'; end if;
  if p_user_id = auth.uid() and not p_value then
    raise exception 'No podés quitarte a vos mismo el acceso a Compras y Ventas';
  end if;
  update public.profiles set acceso_comercial = p_value where id = p_user_id;
end $$;
revoke execute on function public.admin_set_comercial(uuid, boolean) from public, anon;
grant  execute on function public.admin_set_comercial(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- RECORDATORIOS (inicio): todos los usuarios los ven y pueden escribir.
-- Se guarda quién lo escribió. Lo borra quien lo escribió o el admin.
-- ---------------------------------------------------------------------
create table if not exists public.recordatorios (
  id          bigint generated always as identity primary key,
  texto       text not null check (length(trim(texto)) > 0 and length(texto) <= 500),
  creado_por  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists recordatorios_fecha_idx on public.recordatorios(created_at desc);
alter table public.recordatorios enable row level security;
revoke all on public.recordatorios from anon;

drop policy if exists recordatorios_select on public.recordatorios;
create policy recordatorios_select on public.recordatorios for select to authenticated using (true);

drop policy if exists recordatorios_insert on public.recordatorios;
create policy recordatorios_insert on public.recordatorios for insert to authenticated
  with check (creado_por = auth.uid());

drop policy if exists recordatorios_delete on public.recordatorios;
create policy recordatorios_delete on public.recordatorios for delete to authenticated
  using (public.is_admin() or creado_por = auth.uid());

notify pgrst, 'reload schema';
