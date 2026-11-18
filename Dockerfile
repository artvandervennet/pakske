# syntax=docker/dockerfile:1
# Builds and runs Pakske as a plain Node server. Both stages use the same Debian base,
# so the SQLite driver's prebuilt binary matches. On a Raspberry Pi this needs a 64-bit OS
# (`uname -m` says aarch64).

FROM node:26-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@10.34.5
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build

FROM node:26-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    NUXT_DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/.output ./.output
# Read from disk when the server starts, so they live beside the server, not inside it.
COPY --from=build /app/server/db/migrations ./server/db/migrations
COPY --from=build /app/scripts ./scripts
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
