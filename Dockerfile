# ---- Stage 1: build frontend ----
FROM node:22-alpine AS frontend
WORKDIR /frontend
COPY command-deck/package.json command-deck/package-lock.json ./
RUN npm ci
COPY command-deck/. ./
RUN npm run build

# ---- Stage 2: install server deps (with native build tools for better-sqlite3) ----
FROM node:22-alpine AS server-deps
RUN apk add --no-cache python3 make g++
WORKDIR /deps
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ---- Stage 3: build server ----
FROM node:22-alpine AS server-build
RUN apk add --no-cache python3 make g++
WORKDIR /build
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

# ---- Stage 4: runtime ----
FROM node:22-alpine
WORKDIR /app
COPY server/package.json ./
COPY --from=server-deps /deps/node_modules ./node_modules
COPY --from=server-build /build/dist ./dist
COPY --from=frontend /frontend/dist ./public

ENV NODE_ENV=production
ENV PORT=8080
ENV DB_PATH=/app/data/deck.db
EXPOSE 8080

CMD ["sh", "-c", "mkdir -p /app/data && node dist/index.js"]
