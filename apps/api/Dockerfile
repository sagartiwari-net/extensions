# Build from monorepo root: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/crypto/package.json packages/crypto/
RUN npm install --workspace=@oneclk/api --workspace=@oneclk/shared --workspace=@oneclk/crypto --include-workspace-root=false

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY package.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY docs/schema-v1.sql ./docs/schema-v1.sql
RUN npm run build -w @oneclk/shared \
  && npm run build -w @oneclk/crypto \
  && npm run build -w @oneclk/api

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/docs/schema-v1.sql ./docs/schema-v1.sql
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "dist/index.js"]
