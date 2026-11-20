CREATE TABLE IF NOT EXISTS sso_sistemas (
  id text PRIMARY KEY,
  nombre text NOT NULL,
  descripcion text NOT NULL DEFAULT '',
  icono text NOT NULL DEFAULT '',
  url_login text NOT NULL,
  url_acceso text NOT NULL,
  siempre_visible boolean NOT NULL DEFAULT false,
  activo boolean NOT NULL DEFAULT true
);

-- Solo auditoría de pases login emitidos: la verificación de un solo uso la hace cada sistema.
CREATE TABLE IF NOT EXISTS jti_usados (
  jti text PRIMARY KEY,
  aud text NOT NULL,
  sub text NOT NULL,
  emitido timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intentos_ingreso (
  id bigserial PRIMARY KEY,
  correo text NOT NULL,
  ip text NOT NULL,
  ok boolean NOT NULL DEFAULT false,
  creado timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS intentos_correo_idx ON intentos_ingreso (correo, creado);
CREATE INDEX IF NOT EXISTS intentos_ip_idx ON intentos_ingreso (ip, creado);

CREATE TABLE IF NOT EXISTS sso_sesiones (
  id_hash text PRIMARY KEY,           -- sha256 de la cookie; la cookie nunca se guarda
  empleado_id text NOT NULL,
  email text NOT NULL,
  nombre text NOT NULL,
  creada timestamptz NOT NULL DEFAULT now(),
  expira timestamptz NOT NULL,
  cache jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS altcha_usados (
  firma text PRIMARY KEY,
  expira timestamptz NOT NULL
);

-- Intento reservado antes de verificar la clave (cuenta como fallo hasta que se marca ok).
ALTER TABLE intentos_ingreso ADD COLUMN IF NOT EXISTS pendiente boolean NOT NULL DEFAULT false;
