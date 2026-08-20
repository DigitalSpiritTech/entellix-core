FROM node:24-bookworm-slim AS builder

WORKDIR /workspace
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm release:standalone:artifact

FROM node:24-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates postgresql-client

WORKDIR /opt/entellix
COPY --from=builder /workspace/artifacts/entellix-standalone-*.tgz /tmp/standalone.tgz
RUN tar -xzf /tmp/standalone.tgz --strip-components=1 -C /opt/entellix \
  && chown -R node:node /opt/entellix

ENV MASTRA_HOST=0.0.0.0 \
  NODE_ENV=production \
  PORT=4211

USER node
EXPOSE 4211

HEALTHCHECK --interval=5s --timeout=5s --start-period=15s --retries=12 \
  CMD node --input-type=module --eval "const response = await fetch('http://127.0.0.1:4211/healthz'); if (!response.ok) process.exit(1)"

CMD ["node", "server/index.mjs"]
