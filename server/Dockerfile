# Servidor del portal (Express + Postgres). Contexto: ./server.
# bookworm-slim (glibc): argon2 trae binario prebuilt para linux-x64/arm64 glibc; evita compilar.
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Usuario no root (uid 1000 'node' de la imagen). La clave de firma se monta en /run/secrets, nunca se copia.
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
