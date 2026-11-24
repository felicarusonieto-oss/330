-- =====================================================================
--  330 - Compras: cliente, monto sin IVA, IVA 10,5% e IVA 21%
--  "monto" sigue siendo el TOTAL (es lo que se suma a la venta asociada).
--  Ejecutar en Supabase > SQL Editor después de 05. Idempotente.
-- =====================================================================
alter table public.compras add column if not exists cliente text not null default '';
alter table public.compras add column if not exists neto    numeric(14,2);
alter table public.compras add column if not exists iva_105 numeric(14,2) not null default 0;
alter table public.compras add column if not exists iva_21  numeric(14,2) not null default 0;

-- Compras anteriores: se toma el total como monto sin IVA
update public.compras set neto = monto where neto is null;

-- Siempre cuadra: sin IVA + IVA 10,5 + IVA 21 = total.
-- (Si el total se cambia desde Ventas, se ajusta el monto sin IVA.)
create or replace function public.compras_cuadrar()
returns trigger language plpgsql as $$
begin
  if new.neto is null or round(new.neto + new.iva_105 + new.iva_21, 2) <> round(new.monto, 2) then
    new.neto := new.monto - new.iva_105 - new.iva_21;
  end if;
  return new;
end $$;
drop trigger if exists compras_cuadrar on public.compras;
create trigger compras_cuadrar before insert or update on public.compras
  for each row execute function public.compras_cuadrar();

notify pgrst, 'reload schema';
