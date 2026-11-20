-- SSO: funciones SQL security definer, ejecutables SOLO por service_role.
-- Ejecutar con un rol administrador (postgres). Nada de esto se expone a anon/authenticated.
create schema if not exists sso;
revoke all on schema sso from public, anon, authenticated;
grant usage on schema sso to service_role;

-- Un solo uso de pases use=login
create table if not exists sso.jti_usados (
  jti text primary key,
  exp bigint not null,                       -- epoch s del pase
  usado_en timestamptz not null default now()
);
alter table sso.jti_usados enable row level security;  -- sin políticas: solo security definer / service_role
revoke all on sso.jti_usados from public, anon, authenticated;

-- true = primera vez (marcado); false = ya usado
create or replace function sso.marcar_jti(p_jti text, p_exp bigint)
returns boolean language plpgsql security definer set search_path = pg_catalog, sso as $$
declare n int;
begin
  if p_jti is null or length(p_jti) = 0 then return false; end if;
  delete from sso.jti_usados where exp < extract(epoch from now())::bigint - 86400; -- limpieza
  insert into sso.jti_usados(jti, exp) values (p_jti, p_exp) on conflict (jti) do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- Ecodatos: auth.users. Activo = no borrado y no bloqueado.
create or replace function sso.buscar_usuario_ecodatos(p_email text)
returns table(id text, rol text, activo boolean)
language sql stable security definer set search_path = pg_catalog, auth as $$
  select u.id::text, null::text,
         (u.deleted_at is null and (u.banned_until is null or u.banned_until <= now()))
  from auth.users u
  where lower(u.email) = lower(btrim(p_email));
$$;

-- Alerta: tabla/columnas parametrizadas (PENDIENTE de confirmar). Se configuran en sso.alerta_config.
create table if not exists sso.alerta_config (
  singleton boolean primary key default true check (singleton),
  esquema text not null default 'public',
  tabla text,            -- PENDIENTE: nombre real de la tabla de usuarios de Alerta
  col_id text,           -- PENDIENTE
  col_email text,        -- PENDIENTE
  col_activo text,       -- opcional (boolean); null = todos activos
  col_rol text           -- opcional
);
alter table sso.alerta_config enable row level security;
revoke all on sso.alerta_config from public, anon, authenticated;
insert into sso.alerta_config(singleton) values (true) on conflict do nothing;
-- Ejemplo (NO ejecutar hasta confirmar):
-- update sso.alerta_config set esquema='alerta', tabla='usuarios', col_id='id', col_email='correo', col_activo='activo', col_rol='rol';

create or replace function sso.buscar_usuario_alerta(p_email text)
returns table(id text, rol text, activo boolean)
language plpgsql stable security definer set search_path = pg_catalog, sso as $$
declare c sso.alerta_config; q text;
begin
  select * into c from sso.alerta_config where singleton;
  if c.tabla is null or c.col_id is null or c.col_email is null then
    raise exception 'sso.alerta_config sin configurar';
  end if;
  q := format(
    'select t.%1$I::text, %2$s, %3$s from %4$I.%5$I t where lower(btrim(t.%6$I::text)) = lower(btrim($1))',
    c.col_id,
    case when c.col_rol is null then 'null::text' else format('t.%I::text', c.col_rol) end,
    case when c.col_activo is null then 'true' else format('coalesce(t.%I, false)', c.col_activo) end,
    c.esquema, c.tabla, c.col_email);
  return query execute q using p_email;
end $$;

-- Permisos: solo service_role
revoke all on function sso.marcar_jti(text, bigint) from public, anon, authenticated;
revoke all on function sso.buscar_usuario_ecodatos(text) from public, anon, authenticated;
revoke all on function sso.buscar_usuario_alerta(text) from public, anon, authenticated;
grant execute on function sso.marcar_jti(text, bigint) to service_role;
grant execute on function sso.buscar_usuario_ecodatos(text) to service_role;
grant execute on function sso.buscar_usuario_alerta(text) to service_role;
