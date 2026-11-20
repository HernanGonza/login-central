# Front del portal: build con Vite y servido por nginx (base '/', subdominio propio).
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Prefijo donde cuelga el portal. '/portal/' bajo ecodatos (su nginx quita el prefijo: este contenedor sirve en la raíz).
# Para el subdominio propio: --build-arg VITE_BASE=/ (docker-compose lo toma de PORTAL_BASE_PATH).
ARG VITE_BASE=/portal/
ENV VITE_BASE=$VITE_BASE
RUN npm run build

FROM nginx:1.27-alpine
# nginx procesa /etc/nginx/templates/*.template con envsubst al arrancar (solo las variables definidas
# en el entorno; los $uri, $host, etc. de nginx no se tocan). Variables: FORM_ACTION_ORIGINS, API_UPSTREAM.
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
ENV API_UPSTREAM=http://portal-api:3000 \
    FORM_ACTION_ORIGINS=""
EXPOSE 80
