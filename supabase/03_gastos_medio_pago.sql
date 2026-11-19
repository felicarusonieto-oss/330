-- =====================================================================
--  330 - Gastos hormiga: medio de pago (Mercado Pago, Banco, Naranja X, Efectivo)
--  Ejecutar en Supabase > SQL Editor después de 02_modulos.sql. Idempotente.
-- =====================================================================
alter table public.gastos add column if not exists medio_pago text;

alter table public.gastos drop constraint if exists gastos_medio_pago_check;
alter table public.gastos add constraint gastos_medio_pago_check
  check (medio_pago is null or medio_pago in ('mercado_pago', 'banco', 'naranja_x', 'efectivo'));

notify pgrst, 'reload schema';
