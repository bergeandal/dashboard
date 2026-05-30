# ---- Stage 1: build frontend ----
FROM node:22-alpine AS frontend
WORKDIR /frontend
COPY command-deck/package.json command-deck/package-lock.json ./
RUN npm ci
COPY command-deck/. ./
RUN npm run build

# ---- Stage 2: build server ----
FROM node:22-alpine AS server-build
WORKDIR /build
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

# ---- Stage 3: runtime ----
FROM node:22-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=server-build /build/dist ./dist
COPY --from=frontend /frontend/dist ./public

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/index.js"]
