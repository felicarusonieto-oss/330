-- =====================================================================
--  Aberturas - Esquema de usuarios
--  Pegar y ejecutar completo en Supabase > SQL Editor (una sola vez).
--  Es idempotente: se puede volver a ejecutar sin romper nada.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- Dominio interno: los usuarios ingresan con "usuario" y Supabase Auth
-- usa internamente el email  <usuario>@aberturas.local
-- (si se cambia, cambiar también EMAIL_DOMAIN en js/config.js)

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  username              text not null unique check (username ~ '^[a-z0-9._-]{3,30}$'),
  full_name             text not null default '',
  role                  text not null default 'user' check (role in ('admin','user')),
  must_change_password  boolean not null default true,
  active                boolean not null default true,
  created_at            timestamptz not null default now()
);

create table if not exists public.password_reset_requests (
  id           bigint generated always as identity primary key,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references public.profiles(id)
);

alter table public.profiles                enable row level security;
alter table public.password_reset_requests enable row level security;

-- Nadie escribe directo en las tablas: todo pasa por las funciones de abajo.
revoke insert, update, delete on public.profiles                from anon, authenticated;
revoke insert, update, delete on public.password_reset_requests from anon, authenticated;
revoke all on public.profiles, public.password_reset_requests from anon;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role = 'admin' and active);
$$;

-- Políticas de lectura
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists resets_select on public.password_reset_requests;
create policy resets_select on public.password_reset_requests
  for select to authenticated
  using (public.is_admin());

create or replace function public._check_password(p_password text)
returns void language plpgsql immutable as $$
begin
  if p_password is null or length(p_password) < 6 then
    raise exception 'La contraseña debe tener al menos 6 caracteres';
  end if;
end $$;

-- Crea usuario en auth.users + auth.identities + profiles (uso interno)
create or replace function public._create_user(
  p_username text, p_full_name text, p_password text, p_role text)
returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id    uuid := gen_random_uuid();
  v_user  text := lower(trim(p_username));
  v_email text := v_user || '@aberturas.local';
begin
  if v_user !~ '^[a-z0-9._-]{3,30}$' then
    raise exception 'Usuario inválido: use 3 a 30 caracteres (letras, números, punto, guion)';
  end if;
  if exists (select 1 from public.profiles where username = v_user) then
    raise exception 'El usuario "%" ya existe', v_user;
  end if;
  if p_role not in ('admin','user') then
    raise exception 'Rol inválido';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
      v_email, crypt(p_password, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('username', v_user),
      now(), now(), '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
      jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
      'email', now(), now(), now());

  insert into public.profiles (id, username, full_name, role, must_change_password)
  values (v_id, v_user, coalesce(trim(p_full_name), ''), p_role, true);

  return v_id;
end $$;

create or replace function public._set_password(p_user_id uuid, p_password text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  update auth.users
     set encrypted_password = crypt(p_password, gen_salt('bf')),
         updated_at = now()
   where id = p_user_id;
end $$;

-- ---------------------------------------------------------------------
-- Funciones públicas
-- ---------------------------------------------------------------------

-- "Olvidé mi contraseña": deja una solicitud para el administrador.
-- No revela si el usuario existe o no.
create or replace function public.request_password_reset(p_username text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.profiles
   where username = lower(trim(p_username)) and active;
  if v_id is not null and not exists (
       select 1 from public.password_reset_requests
        where profile_id = v_id and resolved_at is null) then
    insert into public.password_reset_requests (profile_id) values (v_id);
  end if;
end $$;

-- El usuario logueado cambia su propia contraseña
create or replace function public.change_own_password(p_new_password text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_username text;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  perform public._check_password(p_new_password);
  select username into v_username from public.profiles where id = auth.uid();
  if lower(p_new_password) = v_username then
    raise exception 'La contraseña no puede ser igual al usuario';
  end if;
  perform public._set_password(auth.uid(), p_new_password);
  update public.profiles set must_change_password = false where id = auth.uid();
end $$;

-- ADMIN: crear usuario (queda obligado a cambiar la clave al entrar)
create or replace function public.admin_create_user(
  p_username text, p_full_name text, p_password text, p_role text default 'user')
returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo el administrador'; end if;
  perform public._check_password(p_password);
  return public._create_user(p_username, p_full_name, p_password, p_role);
end $$;

-- ADMIN: asignar clave temporal (el usuario deberá cambiarla al entrar)
create or replace function public.admin_set_password(p_user_id uuid, p_password text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo el administrador'; end if;
  perform public._check_password(p_password);
  perform public._set_password(p_user_id, p_password);
  update public.profiles set must_change_password = true where id = p_user_id;
  update public.password_reset_requests
     set resolved_at = now(), resolved_by = auth.uid()
   where profile_id = p_user_id and resolved_at is null;
end $$;

-- ADMIN: modificar nombre, rol y estado
create or replace function public.admin_update_user(
  p_user_id uuid, p_full_name text, p_role text, p_active boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo el administrador'; end if;
  if p_role not in ('admin','user') then raise exception 'Rol inválido'; end if;
  if p_user_id = auth.uid() and (p_role <> 'admin' or not p_active) then
    raise exception 'No podés quitarte el rol de administrador ni desactivarte a vos mismo';
  end if;

  update public.profiles
     set full_name = coalesce(trim(p_full_name), ''), role = p_role, active = p_active
   where id = p_user_id;

  -- Usuario inactivo => Supabase Auth le bloquea el ingreso
  update auth.users
     set banned_until = case when p_active then null else '2999-12-31'::timestamptz end,
         updated_at = now()
   where id = p_user_id;
end $$;

-- ADMIN: descartar una solicitud de "olvidé mi contraseña"
create or replace function public.admin_dismiss_request(p_request_id bigint)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Solo el administrador'; end if;
  update public.password_reset_requests
     set resolved_at = now(), resolved_by = auth.uid()
   where id = p_request_id and resolved_at is null;
end $$;

-- ---------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------
revoke execute on function public._check_password(text)                 from public, anon, authenticated;
revoke execute on function public._create_user(text, text, text, text)  from public, anon, authenticated;
revoke execute on function public._set_password(uuid, text)             from public, anon, authenticated;

revoke execute on function public.request_password_reset(text)                         from public;
revoke execute on function public.change_own_password(text)                            from public, anon;
revoke execute on function public.admin_create_user(text, text, text, text)            from public, anon;
revoke execute on function public.admin_set_password(uuid, text)                       from public, anon;
revoke execute on function public.admin_update_user(uuid, text, text, boolean)         from public, anon;
revoke execute on function public.admin_dismiss_request(bigint)                        from public, anon;

grant execute on function public.is_admin()                                            to authenticated;
grant execute on function public.request_password_reset(text)                          to anon, authenticated;
grant execute on function public.change_own_password(text)                             to authenticated;
grant execute on function public.admin_create_user(text, text, text, text)             to authenticated;
grant execute on function public.admin_set_password(uuid, text)                        to authenticated;
grant execute on function public.admin_update_user(uuid, text, text, boolean)          to authenticated;
grant execute on function public.admin_dismiss_request(bigint)                         to authenticated;

-- ---------------------------------------------------------------------
-- Administrador inicial:  usuario "felipe"  /  clave "1234"
-- (en el primer ingreso el sistema obliga a cambiar la clave)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.profiles where username = 'felipe') then
    perform public._create_user('felipe', 'Felipe', '1234', 'admin');
  end if;
end $$;
