# Servidor del portal (Express + Postgres). Contexto: ./server.
# bookworm-slim (glibc): argon2 trae binario prebuilt para linux-x64/arm64 glibc; evita compilar.
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: el script de instalación de argon2 intenta compilar con node-gyp (no hay Python ni compilador en la imagen);
# no hace falta: el paquete trae el binario precompilado y lo carga en tiempo de ejecución. El `node -e` de abajo falla el build si no carga.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && node -e "require('argon2').hash('x').then(()=>console.log('argon2 OK'))" \
 && npm cache clean --force

FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Usuario no root (uid 1000 'node' de la imagen). La clave de firma se monta en /run/secrets, nunca se copia.
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
