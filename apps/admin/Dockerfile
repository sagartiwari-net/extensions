# Build from monorepo root:
#   docker build -f apps/admin/Dockerfile --build-arg NEXT_PUBLIC_API_BASE=https://api.example.com .
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/admin/package.json apps/admin/
COPY packages/shared/package.json packages/shared/
RUN npm install --workspace=@oneclk/admin --workspace=@oneclk/shared --include-workspace-root=false

FROM node:22-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_BASE=http://127.0.0.1:4000
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/shared ./packages/shared
COPY apps/admin ./apps/admin
RUN mkdir -p apps/admin/public \
  && npm run build -w @oneclk/shared \
  && npm run build -w @oneclk/admin

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/apps/admin/public ./apps/admin/public
COPY --from=build /app/apps/admin/.next/standalone ./
COPY --from=build /app/apps/admin/.next/static ./apps/admin/.next/static
EXPOSE 3000
CMD ["node", "apps/admin/server.js"]
