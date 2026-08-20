# Entellix Standalone

Entellix Standalone is the early-public-beta, single-workspace Entellix
distribution. It combines the public memory engine with a fixed local actor and
workspace, one bearer token, PostgreSQL persistence, an automatic processing
worker, and operator endpoints.

This is a self-hosted reference distribution, not a turnkey managed service. It
has no multi-user identity, tenant isolation, browser UI, built-in TLS, secret
manager, backup scheduler, or high-availability automation. Do not expose it to
an untrusted network without the production controls described below.

## Prerequisites

The recommended local evaluation path requires Docker Desktop or Docker Engine
with Compose, plus an Anthropic API key. It does not use a host PostgreSQL
installation.

The manual paths have these additional requirements:

| Dependency        | Supported or required                                                    |
| ----------------- | ------------------------------------------------------------------------ |
| Node.js           | 24 or newer                                                              |
| PostgreSQL server | 16, 17, or 18                                                            |
| `psql`            | Required for archive migrations; use a client compatible with the server |
| pnpm              | 11.9.0, source-checkout path only                                        |
| GitHub CLI        | Archive path only; required to download and verify the attestation       |

The PostgreSQL range is exercised by the repository clean-room CI matrix. The
default generation model is `claude-haiku-4-5-20251001`. Confirm that the model
is available to your Anthropic account or set `ENTELLIX_GENERATION_MODEL` to a
compatible Anthropic model you can use.

## Quickstart with Docker Compose

This is the recommended way to evaluate Entellix locally from a source
checkout. It builds the verified standalone archive, runs it as a non-root
container, and starts PostgreSQL 16 on a private Compose network. PostgreSQL is
not published to the host, and this path does not read
`apps/standalone/.env` or connect to a host database.

```sh
git clone https://github.com/DigitalSpiritTech/entellix-core.git
cd entellix-core
cp apps/standalone/.env.compose.example apps/standalone/.env.compose
openssl rand -hex 32
nano apps/standalone/.env.compose
```

Set the generated token and your Anthropic key:

```dotenv
ENTELLIX_LOCAL_TOKEN=<output-from-openssl>
ANTHROPIC_API_KEY=<anthropic-api-key>
```

Build the image, start the isolated stack, and wait for both services to become
healthy:

```sh
docker compose up --build --detach --wait
docker compose logs --follow standalone
```

The API is available at `http://localhost:4211`. Compose stores database files
in the `entellix-local_entellix-postgres-data` named volume. Stop the services
without deleting memories with:

```sh
docker compose down
```

To intentionally delete the Compose database and start over, run
`docker compose down --volumes`. That operation permanently removes memories in
the Compose volume; it does not affect a host PostgreSQL database.

## Quickstart from the release archive

The release archive is the recommended evaluation path. It contains the built
server and production dependencies; do not run `npm install` inside it.

Choose the version shown on the repository's Releases page, then download and
verify its GitHub artifact attestation:

```sh
export ENTELLIX_VERSION='<release-version>'
export ENTELLIX_TAG="@entellix/standalone@${ENTELLIX_VERSION}"
export ENTELLIX_ARCHIVE="entellix-standalone-${ENTELLIX_VERSION}.tgz"

gh release download "$ENTELLIX_TAG" \
  --repo DigitalSpiritTech/entellix-core \
  --pattern "$ENTELLIX_ARCHIVE"
gh attestation verify "$ENTELLIX_ARCHIVE" \
  --repo DigitalSpiritTech/entellix-core
tar -xzf "$ENTELLIX_ARCHIVE"
cd "entellix-standalone-${ENTELLIX_VERSION}"
```

Create an empty PostgreSQL database and login. These commands are suitable for
a local PostgreSQL installation and prompt rather than putting the password in
shell history:

```sh
createuser --pwprompt entellix
createdb --owner=entellix entellix
```

Create the runtime configuration and replace the database password and
Anthropic key. Generate a separate high-entropy bearer token:

```sh
cp .env.example .env
openssl rand -hex 32
chmod 600 .env
```

At minimum, set these values in `.env`:

```dotenv
DATABASE_URL=postgres://entellix:<database-password>@127.0.0.1:5432/entellix
ENTELLIX_LOCAL_TOKEN=<output-from-openssl>
ANTHROPIC_API_KEY=<anthropic-api-key>
ENTELLIX_API_URL=http://localhost:4211
```

Apply migrations and start the server:

```sh
npm run migrate
npm start
```

`npm run migrate` is idempotent and records each applied SQL file in
`standalone_schema_migrations`. Startup also checks migrations, but running the
explicit command makes database changes visible before the server starts.

## Quickstart from a source checkout

Use this path when contributing to Entellix Core:

```sh
git clone https://github.com/DigitalSpiritTech/entellix-core.git
cd entellix-core
corepack enable
pnpm install --frozen-lockfile
cp apps/standalone/.env.example apps/standalone/.env
```

Remain in the repository root, edit `apps/standalone/.env`, then export it into
the current shell before using the root workspace commands:

```sh
set -a
source ./apps/standalone/.env
set +a
pnpm run standalone:migrate
pnpm run dev
```

The development server defaults to port `4211`.

## Verify health and authentication

From another terminal:

```sh
export ENTELLIX_BASE_URL=http://localhost:4211
export ENTELLIX_LOCAL_TOKEN='<same-token-as-.env>'

curl --fail --silent "$ENTELLIX_BASE_URL/healthz"
curl --fail --silent \
  -H "Authorization: Bearer $ENTELLIX_LOCAL_TOKEN" \
  "$ENTELLIX_BASE_URL/operator/v1/reviews"
```

The health response is
`{"ok":true,"distribution":"standalone","workspace":"single"}`. MCP and
operator routes reject missing or incorrect bearer tokens with HTTP 401.

## Connect an MCP client

The Streamable HTTP endpoint is:

```text
http://localhost:4211/api/mcp/entellix/mcp
```

For Codex CLI, the IDE extension, or the ChatGPT desktop app's Codex host,
export the token in the environment that launches Codex and add this to
`~/.codex/config.toml` (or a trusted project's `.codex/config.toml`):

```toml
[mcp_servers.entellix]
url = "http://localhost:4211/api/mcp/entellix/mcp"
bearer_token_env_var = "ENTELLIX_LOCAL_TOKEN"
required = true
```

Restart the client, then use `/mcp` or `codex mcp list` to confirm that the six
Entellix tools are available. The configuration follows the official
[Codex MCP configuration reference](https://developers.openai.com/codex/mcp/).

## First memory round trip

Processing is asynchronous. In the connected client:

1. Ask it to remember an explicit, low-sensitivity preference, such as “Remember
   that I prefer UTC timestamps in public APIs.” The `save_memory` receipt should
   report `queued`; it does not claim that a memory already exists.
2. Allow one worker interval (the default is two seconds).
3. Ask explicitly to list saved memories. The client should call
   `list_memories`, and the processed preference should appear if policy allowed
   automatic commit. Candidates that need a human decision appear in the review
   queue instead.

For a release gate, repository maintainers run the clean-room smoke runner
against the candidate archive with `--provider-round-trip`; it exercises the
same authenticated MCP initialize, tool discovery, save, process, review
approval, and list flow.

## Optional embedding retrieval

Without embedding configuration, retrieval uses PostgreSQL full-text search.
To add semantic retrieval, configure a Voyage-compatible embeddings endpoint:

```dotenv
ENTELLIX_EMBEDDING_URL=https://api.voyageai.com/v1/embeddings
ENTELLIX_EMBEDDING_API_KEY=<embedding-provider-key>
ENTELLIX_EMBEDDING_MODEL=voyage-4
```

Restart the server after changing these values. Existing memories without an
embedding remain available to lexical retrieval; this beta does not include a
background embedding backfill command.

## Operator routes

All operator routes require `Authorization: Bearer $ENTELLIX_LOCAL_TOKEN`.

List the review queue:

```sh
curl --fail --silent \
  -H "Authorization: Bearer $ENTELLIX_LOCAL_TOKEN" \
  "$ENTELLIX_BASE_URL/operator/v1/reviews"
```

Approve a queued candidate after reviewing its evidence and visibility:

```sh
curl --fail --silent --request POST \
  -H "Authorization: Bearer $ENTELLIX_LOCAL_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"candidateId":"<candidate-uuid>","action":"approve"}' \
  "$ENTELLIX_BASE_URL/operator/v1/reviews/decision"
```

Run raw-event retention immediately:

```sh
curl --fail --silent --request POST \
  -H "Authorization: Bearer $ENTELLIX_LOCAL_TOKEN" \
  "$ENTELLIX_BASE_URL/operator/v1/retention/run"
```

Export the workspace to a protected local file:

```sh
umask 077
curl --fail --silent \
  -H "Authorization: Bearer $ENTELLIX_LOCAL_TOKEN" \
  "$ENTELLIX_BASE_URL/operator/v1/data/export" \
  --output entellix-export.json
```

### Permanently delete workspace data

Warning: the next operation deletes the standalone workspace's Entellix memory
data. It is irreversible unless you have a usable database backup. Export and
back up the database first, stop all other clients, and verify the target URL.

The route requires both bearer authentication and an explicit confirmation
header:

```sh
curl --fail --silent --request DELETE \
  -H "Authorization: Bearer $ENTELLIX_LOCAL_TOKEN" \
  -H 'x-entellix-confirm-delete: delete-workspace' \
  "$ENTELLIX_BASE_URL/operator/v1/data"
```

## Production and operations guidance

- Bind the service to a private interface. Terminate TLS at a maintained reverse
  proxy and restrict network access to trusted MCP clients.
- Store `.env` with mode `0600`, use separate PostgreSQL and provider
  credentials, rotate the bearer token if exposed, and never commit secrets.
- Review Anthropic and embedding-provider data handling before sending user
  context. The worker sends candidate-generation prompts to Anthropic and sends
  memory/query text to the embedding provider when enabled.
- Back up with `pg_dump`, test restoration with `pg_restore`, and retain backups
  separately from the host. The export route is a data-rights export, not a full
  operational database backup.
- Before upgrading, read all package and standalone changelogs, back up the
  database, download and attest the new archive, run `npm run migrate`, then
  health-check and perform a memory lookup before retiring the prior version.
- Capture stdout/stderr and monitor `/healthz`. This beta does not ship metrics,
  tracing, alerting, automatic restarts, or log rotation.

Mastra transport and session state is stored in PostgreSQL under the
`entellix_mastra` schema. Entellix memory tables and migration history use the
database's default schema.

## License

The distribution is licensed under Apache-2.0. Entellix names and branding
remain subject to the repository trademark policy.
