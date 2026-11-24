-- =====================================================================
--  330 - Ventas: quién hizo la venta + formas de pago con montos.
--        Compras: formas de pago con montos.
--  pagos = [ { "medio": "transf_payo" | "transf_felipe" | "transf_cliente" | "efectivo",
--              "monto": 12345.67 }, ... ]
--  Ejecutar después de 07. Idempotente.
-- =====================================================================
alter table public.ventas  add column if not exists vendedor text  not null default '';
alter table public.ventas  add column if not exists pagos    jsonb not null default '[]'::jsonb;
alter table public.compras add column if not exists pagos    jsonb not null default '[]'::jsonb;

-- Resumen de ventas: se agregan vendedor y pagos al final
create or replace view public.ventas_resumen with (security_invoker = true) as
select v.id, v.fecha, v.cliente, v.descripcion, v.precio_final, v.created_at,
       coalesce(c.total, 0)::numeric(14,2)                    as compra_total,
       (v.precio_final - coalesce(c.total, 0))::numeric(14,2) as utilidad,
       coalesce(c.cantidad, 0)::int                           as compras_cant,
       v.vendedor, v.pagos
  from public.ventas v
  left join (select venta_id, sum(monto) as total, count(*) as cantidad
               from public.compras where venta_id is not null
              group by venta_id) c on c.venta_id = v.id;

-- Guarda la venta y deja asociadas exactamente las compras indicadas.
-- p = { id?, fecha, cliente, descripcion, precio_final, vendedor, pagos: [...], compra_ids: [1,2,...] }
-- Las compras que se quitan NO se borran: quedan "sin vincular" en Compras.
create or replace function public.guardar_venta(p jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint := nullif(p->>'id', '')::bigint;
  ids  bigint[] := coalesce(array(select (x)::bigint from jsonb_array_elements_text(coalesce(p->'compra_ids', '[]'::jsonb)) x), '{}');
begin
  if not public.is_admin() then raise exception 'Solo el administrador'; end if;
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
revoke execute on function public.guardar_venta(jsonb) from public, anon;
grant  execute on function public.guardar_venta(jsonb) to authenticated;

notify pgrst, 'reload schema';
