#!/usr/bin/env bash
# Genera el par RSA de firma del portal en ./secrets/ (relativo a la raíz del repo).
# No sobrescribe una clave existente. No imprime la clave privada; imprime el kid.
set -euo pipefail
cd "$(dirname "$0")/.."
BITS="${BITS:-3072}"          # mínimo aceptado: 2048
[ "$BITS" -ge 2048 ] || { echo "BITS debe ser >= 2048" >&2; exit 1; }
command -v openssl >/dev/null || { echo "Falta openssl" >&2; exit 1; }

PRIV=secrets/sso-private.pem
PUB=secrets/sso-public.pem
if [ -e "$PRIV" ]; then
  echo "Ya existe $PRIV: no se sobrescribe. Para rotar, muévala a otro nombre y vuelva a ejecutar." >&2
  exit 1
fi

mkdir -p secrets && chmod 700 secrets
umask 077
openssl genpkey -algorithm RSA -pkeyopt "rsa_keygen_bits:$BITS" -out "$PRIV" 2>/dev/null
openssl pkey -in "$PRIV" -pubout -out "$PUB"
chmod 600 "$PRIV" "$PUB"
# El contenedor corre como uid 1000 (usuario node) y monta el archivo de solo lectura:
# si su dueño no es 1000, hace falta que sea legible. Se deja 644 SOLO si el uid del host no es 1000.
if [ "$(id -u)" != "1000" ]; then chmod 644 "$PRIV"; echo "Aviso: uid del host != 1000; $PRIV queda 644 para que lo lea el contenedor (el directorio secrets/ es 700)." >&2; fi

# kid = huella JWK (RFC 7638, SHA-256 base64url), igual a la que calcula el servidor si no se fija SSO_KID.
# Exponente 65537 ("AQAB", el que usa openssl por defecto).
N=$(openssl rsa -pubin -in "$PUB" -modulus -noout | sed 's/^Modulus=//' | xxd -r -p | openssl base64 -A | tr '+/' '-_' | tr -d '=')
KID=$(printf '{"e":"AQAB","kty":"RSA","n":"%s"}' "$N" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
echo "Clave generada: $PRIV (RSA $BITS, modo 600). Pública: $PUB"
echo "kid (huella JWK): $KID"
echo "Confirme el kid real tras levantar el portal: curl -s https://portal.ecologia.misiones.gob.ar/.well-known/jwks.json"
