-- =====================================================================
--  330 - Módulos: Ventas, Compras, Monotributo, Gastos hormiga, Tareas
--  Ejecutar en Supabase > SQL Editor DESPUÉS de schema.sql.
--  Es idempotente: se puede volver a ejecutar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Lista básica de usuarios (para asignar tareas). Visible para todos los
-- usuarios logueados, sin datos sensibles.
-- ---------------------------------------------------------------------
create or replace function public.list_users_basic()
returns table (id uuid, username text, full_name text)
language sql stable security definer set search_path = public as $$
  select id, username, full_name from public.profiles
   where active order by coalesce(nullif(full_name, ''), username);
$$;
revoke execute on function public.list_users_basic() from public, anon;
grant  execute on function public.list_users_basic() to authenticated;

-- ---------------------------------------------------------------------
-- VENTAS y COMPRAS
-- ---------------------------------------------------------------------
create table if not exists public.ventas (
  id            bigint generated always as identity primary key,
  fecha         date not null default current_date,
  cliente       text not null default '',
  descripcion   text not null default '',
  precio_final  numeric(14,2) not null default 0 check (precio_final >= 0),
  created_by    uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create table if not exists public.compras (
  id          bigint generated always as identity primary key,
  fecha       date not null default current_date,
  proveedor   text not null check (length(trim(proveedor)) > 0),
  detalle     text not null default '',
  monto       numeric(14,2) not null check (monto >= 0),
  venta_id    bigint references public.ventas(id) on delete set null,
  created_by  uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists compras_venta_idx on public.compras(venta_id);
create index if not exists compras_fecha_idx on public.compras(fecha);
create index if not exists ventas_fecha_idx  on public.ventas(fecha);

-- Venta + total de compras asociadas + utilidad (calculada sola)
create or replace view public.ventas_resumen with (security_invoker = true) as
select v.id, v.fecha, v.cliente, v.descripcion, v.precio_final, v.created_at,
       coalesce(c.total, 0)::numeric(14,2)                  as compra_total,
       (v.precio_final - coalesce(c.total, 0))::numeric(14,2) as utilidad,
       coalesce(c.cantidad, 0)::int                         as compras_cant
  from public.ventas v
  left join (select venta_id, sum(monto) as total, count(*) as cantidad
               from public.compras where venta_id is not null
              group by venta_id) c on c.venta_id = v.id;

-- Guarda una venta con sus compras en un solo paso.
-- p = { id?, fecha, cliente, descripcion, precio_final,
--       compras: [ { id?, fecha?, proveedor, detalle, monto } ] }
-- Las compras que se quitan de la venta NO se borran: quedan "sin asignar".
create or replace function public.save_venta(p jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id  bigint := nullif(p->>'id', '')::bigint;
  c     jsonb;
  c_id  bigint;
  keep  bigint[] := '{}';
begin
  if not public.is_admin() then raise exception 'Solo el administrador'; end if;

  if v_id is null then
    insert into public.ventas (fecha, cliente, descripcion, precio_final)
    values (coalesce(nullif(p->>'fecha', '')::date, current_date),
            coalesce(trim(p->>'cliente'), ''),
            coalesce(trim(p->>'descripcion'), ''),
            coalesce(nullif(p->>'precio_final', '')::numeric, 0))
    returning id into v_id;
  else
    update public.ventas
       set fecha        = coalesce(nullif(p->>'fecha', '')::date, fecha),
           cliente      = coalesce(trim(p->>'cliente'), ''),
           descripcion  = coalesce(trim(p->>'descripcion'), ''),
           precio_final = coalesce(nullif(p->>'precio_final', '')::numeric, 0)
     where id = v_id;
    if not found then raise exception 'La venta no existe'; end if;
  end if;

  for c in select * from jsonb_array_elements(coalesce(p->'compras', '[]'::jsonb)) loop
    if coalesce(trim(c->>'proveedor'), '') = '' then
      raise exception 'Cada compra necesita un proveedor';
    end if;
    c_id := nullif(c->>'id', '')::bigint;
    if c_id is not null then
      update public.compras
         set proveedor = trim(c->>'proveedor'),
             detalle   = coalesce(trim(c->>'detalle'), ''),
             monto     = coalesce(nullif(c->>'monto', '')::numeric, 0),
             venta_id  = v_id
       where id = c_id;
    else
      insert into public.compras (fecha, proveedor, detalle, monto, venta_id)
      values (coalesce(nullif(c->>'fecha', '')::date, nullif(p->>'fecha', '')::date, current_date),
              trim(c->>'proveedor'), coalesce(trim(c->>'detalle'), ''),
              coalesce(nullif(c->>'monto', '')::numeric, 0), v_id)
      returning id into c_id;
    end if;
    keep := keep || c_id;
  end loop;

  update public.compras set venta_id = null
   where venta_id = v_id and not (id = any(keep));

  return v_id;
end $$;
revoke execute on function public.save_venta(jsonb) from public, anon;
grant  execute on function public.save_venta(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- MONOTRIBUTO: cuota mensual + facturas
-- ---------------------------------------------------------------------
create table if not exists public.monotributo_meses (
  periodo           date primary key check (extract(day from periodo) = 1),
  cuota             numeric(14,2) not null default 0,
  pagado            boolean not null default false,
  fecha_pago        date,
  comprobante_path  text,
  comprobante_nombre text,
  notas             text not null default ''
);

create table if not exists public.facturas (
  id              bigint generated always as identity primary key,
  periodo         date not null check (extract(day from periodo) = 1),
  tipo            text not null default 'emitida' check (tipo in ('emitida','recibida')),
  fecha           date not null default current_date,
  numero          text not null default '',
  contraparte     text not null default '',
  monto           numeric(14,2) not null default 0,
  archivo_path    text,
  archivo_nombre  text,
  created_at      timestamptz not null default now()
);
create index if not exists facturas_periodo_idx on public.facturas(periodo);

-- ---------------------------------------------------------------------
-- GASTOS HORMIGA
-- ---------------------------------------------------------------------
create table if not exists public.gastos (
  id           bigint generated always as identity primary key,
  fecha        date not null default current_date,
  descripcion  text not null default '',
  categoria    text not null default 'Otros',
  monto        numeric(14,2) not null check (monto >= 0),
  created_by   uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists gastos_fecha_idx on public.gastos(fecha);

-- Permisos: solo el administrador ve y modifica estas tablas
do $$
declare t text;
begin
  foreach t in array array['ventas','compras','monotributo_meses','facturas','gastos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated
                      using (public.is_admin()) with check (public.is_admin())', t || '_admin', t);
  end loop;
end $$;
revoke all on public.ventas_resumen from anon;

-- ---------------------------------------------------------------------
-- TAREAS (Taller / Oficina)
-- ---------------------------------------------------------------------
create table if not exists public.tareas (
  id             bigint generated always as identity primary key,
  area           text not null check (area in ('taller','oficina')),
  titulo         text not null check (length(trim(titulo)) > 0),
  descripcion    text not null default '',
  asignado_a     uuid references public.profiles(id) on delete set null,
  creado_por     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  estado         text not null default 'pendiente' check (estado in ('pendiente','en_curso','hecha')),
  fecha_limite   date,
  completada_at  timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists tareas_area_idx on public.tareas(area, estado);
create index if not exists tareas_asignado_idx on public.tareas(asignado_a);

-- El creador no se puede cambiar y la fecha de finalización se marca sola
create or replace function public.tareas_before_write()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    new.creado_por := old.creado_por;
  end if;
  if new.estado = 'hecha' and (tg_op = 'INSERT' or old.estado <> 'hecha') then
    new.completada_at := now();
  elsif new.estado <> 'hecha' then
    new.completada_at := null;
  end if;
  return new;
end $$;
drop trigger if exists tareas_before_write on public.tareas;
create trigger tareas_before_write before insert or update on public.tareas
  for each row execute function public.tareas_before_write();

alter table public.tareas enable row level security;
revoke all on public.tareas from anon;

drop policy if exists tareas_select on public.tareas;
create policy tareas_select on public.tareas for select to authenticated
  using (public.is_admin() or asignado_a = auth.uid() or creado_por = auth.uid());

drop policy if exists tareas_insert on public.tareas;
create policy tareas_insert on public.tareas for insert to authenticated
  with check (creado_por = auth.uid());

-- Quien la creó, a quien se le asignó o el admin pueden actualizarla
-- (incluso pasársela a otro usuario)
drop policy if exists tareas_update on public.tareas;
create policy tareas_update on public.tareas for update to authenticated
  using (public.is_admin() or asignado_a = auth.uid() or creado_por = auth.uid())
  with check (true);

drop policy if exists tareas_delete on public.tareas;
create policy tareas_delete on public.tareas for delete to authenticated
  using (public.is_admin() or creado_por = auth.uid());

-- ---------------------------------------------------------------------
-- ARCHIVOS de facturas y comprobantes (Storage privado, solo admin)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('facturas', 'facturas', false)
on conflict (id) do nothing;

drop policy if exists facturas_admin_select on storage.objects;
create policy facturas_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'facturas' and public.is_admin());

drop policy if exists facturas_admin_insert on storage.objects;
create policy facturas_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'facturas' and public.is_admin());

drop policy if exists facturas_admin_update on storage.objects;
create policy facturas_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'facturas' and public.is_admin());

drop policy if exists facturas_admin_delete on storage.objects;
create policy facturas_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'facturas' and public.is_admin());
