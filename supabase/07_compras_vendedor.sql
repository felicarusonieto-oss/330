-- =====================================================================
--  330 - Compras: "Venta de" (quién trae la venta: Felipe, Andrea, Diego,
--  Braian, Sergio, Payo). Ejecutar después de 06. Idempotente.
-- =====================================================================
alter table public.compras add column if not exists vendedor text not null default '';

notify pgrst, 'reload schema';
