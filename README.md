# Sproutsite MCP

Sproutsite MCP exposes Sproutsite's documentation and component showcase as a public, read-only MCP service over Streamable HTTP.

The Docker image contains the server, its runtime dependencies and its license. At startup, the server reads the selected Sproutsite snapshot from a local data directory. It checks schema version 1, validates the export against its JSON Schema and verifies the source repository, Git commit, clean-checkout provenance, Sproutsite version and all five SHA-256 digests against the lockfile.

## Run locally

Prepare an existing export from a clean Sproutsite checkout. Use Node.js 24 LTS, npm, Git and Docker Compose.

```sh
npm ci
npm run build

source_commit=132f9063fc9b7058103cda056cf52ea40b42c05e
export MCP_DATA_DIR="$PWD/data/$source_commit"
npm run import:snapshot -- ../sproutsite "$source_commit" "$MCP_DATA_DIR"
npm run verify:snapshot

docker compose up --build -d --wait
curl --fail http://127.0.0.1:3000/healthz
npm run test:client -- http://127.0.0.1:3000/mcp
```

Set `source_commit` to the full commit of the export you are importing. The import creates a new data directory and requires the destination to be unused. Compose mounts that directory read-only at `/data` and publishes the service on loopback. Set `MCP_PORT` to change the host port. The image runs as the non-root `node` user, so the mounted directories and files must be readable by that user. Use `docker compose down` to stop the local service.

The Docker healthcheck calls `GET /healthz`. A healthy response includes `sproutsiteVersion` and `sourceCommit` from the loaded snapshot. To run the server directly, keep `MCP_DATA_DIR` set and run `npm start`. The Node process defaults to `HOST=127.0.0.1` and `PORT=3000`. The image listens on `0.0.0.0:3000` inside the container.

## Deploy behind Traefik

Set `MCP_DATA_DIR` in the local `.env` to the absolute path of the
prepared snapshot. The snapshot must be readable by the container's
`node` user. Use a Compose version that supports `!reset` and `up --wait`.
The production override removes the loopback port mapping and attaches
the service to the existing `traefik-public` network.

```sh
docker compose -f compose.yaml -f compose.production.yaml config --quiet
docker compose -f compose.yaml -f compose.production.yaml up --build -d --wait
docker compose -f compose.yaml -f compose.production.yaml exec -T mcp \
  node -e "fetch('http://127.0.0.1:3000/healthz').then(r => r.text()).then(console.log)"
npm run test:client -- https://mcp.sproutsite.dev/mcp
```

Check the expected commit and version in the internal health response.
Use both Compose files when stopping or updating the production service.

To expose the landing page after deploying an image that includes it, use
this exact Traefik router rule. The existing router can retain its TLS,
service, rate limit, and access-log settings.

```yaml
traefik.http.routers.sproutsite-mcp.rule: >-
  Host(`mcp.sproutsite.dev`) &&
  (Path(`/`) || Path(`/mcp`) ||
   Path(`/assets/sproutsite-mcp.css`) ||
   Path(`/assets/sproutsite-logo.svg`) ||
   Path(`/assets/sproutsite-wave.svg`) ||
   Path(`/assets/nunito-latin-variable.woff2`) ||
   Path(`/assets/eb-garamond-latin-variable.woff2`))
```

Keep `/healthz` internal. The landing page and its assets use the exact
paths in the rule above.

### Landing page asset sources

Source paths below are relative to the Sproutsite repository. The image
bundles the license and attribution files under `public/licenses/`.

| Bundled asset | Sproutsite source | Bundled license and notices |
| --- | --- | --- |
| `sproutsite-logo.svg` | `public/branding/logo-light.svg` (official navbar symbol for dark backgrounds) | `Sproutsite-LICENSE.txt`, `Sproutsite-NOTICE.txt` |
| `sproutsite-wave.svg` | `public/backgrounds/hero-waves.svg` | `Sproutsite-LICENSE.txt`, `Sproutsite-NOTICE.txt` |
| `nunito-latin-variable.woff2` | `src/themes/default/styles/foundation/fonts/nunito-latin-variable.woff2` | `Nunito-OFL.txt`, copied from `src/themes/default/styles/foundation/fonts/OFL.txt` |
| `eb-garamond-latin-variable.woff2` | `src/themes/default/styles/foundation/fonts/eb-garamond-latin-variable.woff2` | `EB-Garamond-OFL.txt`, copied from `src/themes/default/styles/foundation/fonts/eb-garamond-OFL.txt` |

The SVGs are copied unchanged. The landing page CSS controls the hero
wave crop. The retained starter notice is copied from
`src/package/starter-assets/public/NOTICE.txt` and applies to the neutral
starter assets.

## Connect an MCP client

Add a remote MCP server in your client, select **Streamable HTTP**, and enter `http://127.0.0.1:3000/mcp`. For a client that uses the common JSON configuration format, the local entry looks like this.

```json
{
  "mcpServers": {
    "sproutsite": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

For a self-hosted instance, use its own HTTPS URL ending in `/mcp`, for example `https://mcp.example.org/mcp`.

The endpoint is unauthenticated and stateless. It accepts MCP over POST and returns JSON. Clients that send an `Origin` header must use an origin allowed by the [server](src/http.ts). See the [official MCP TypeScript SDK transport guide](https://ts.sdk.modelcontextprotocol.io/server).

| Tool | Example input | Result |
| --- | --- | --- |
| `search_documentation` | `{"query":"Accordion","language":"en","limit":5}` | Ranked documentation and showcase pages with stable IDs. The default limit is 5 and the maximum is 20. |
| `get_document` | `{"id":"showcase/accordions","language":"de"}` | The page's full Markdown, translations and ordered sections, including examples and their notices. |
| `get_component` | `{"name":"Accordion","language":"de"}` | The public export name, import path and mapped guide with its examples, documented tables and notices. |

All entries include the canonical source `url`, `language` and `sproutsiteVersion`. English (`en`) is the default, and German (`de`) is available through `language`. A locale-qualified document ID such as `showcase/accordions:de` selects its own language when the parameter is omitted. You can use the parameter to request the same page in another language. Results only use content available in the selected language. Examples retain the original alerts and badges in their sections, including open and partly available features.

## Prepare a snapshot

1. Select a reviewed Sproutsite commit that contains the exporter. In a clean checkout at that exact commit, run `npm ci` followed by `npm run export:mcp` with the production URL and base settings. If `artifacts/mcp/` already contains the export for that commit, you can import it directly. [Sproutsite export contract](https://github.com/sproutsite/sproutsite/blob/132f9063fc9b7058103cda056cf52ea40b42c05e/docs/mcp-export.md)
2. From this repository, run `npm run import:snapshot -- <sproutsite-checkout> <full-git-commit> <new-data-directory>`. The importer checks that the checkout is clean and at the requested commit, reads the expected version and repository from that commit, and verifies the three attribution files against Git. It generates the lock from the original bytes, then validates the copied export and its digests before writing the final lockfile.
3. Keep each prepared snapshot in its own directory. Retain the active directory and at least its predecessor. Each directory has this layout.

   ```text
   snapshot-lock.json
   snapshot/
     snapshot.json
     schema.json
     LICENSE
     NOTICE
     THIRD_PARTY_NOTICES.md
   ```

## Switch or roll back with the same image

Use the same locally available image for both steps. Compose defaults to `sproutsite-mcp:local`. In production, set `MCP_IMAGE` to the fixed image reference already available on the host. Keep the old directory intact and record its path before switching. Replace `NEW_COMMIT` in the example with the prepared snapshot directory name.

```sh
previous_snapshot="$MCP_DATA_DIR"
candidate_snapshot=/srv/sproutsite-mcp/snapshots/NEW_COMMIT

# Validate the new mount in a separate container while the current service runs.
MCP_DATA_DIR="$candidate_snapshot" docker compose run --rm --no-deps --pull never mcp \
  node dist/src/main.js --verify-snapshot

# Recreate the service with the new mount.
export MCP_DATA_DIR="$candidate_snapshot"
docker compose up -d --no-build --pull never --force-recreate --wait
curl --fail http://127.0.0.1:3000/healthz
npm run test:client -- http://127.0.0.1:3000/mcp
```

Confirm the expected commit and version in the health response. For production, persist the selected `MCP_DATA_DIR` in the environment used by Compose once the checks pass. Recreating the service briefly interrupts requests to the single container.

To roll back, restore the previous directory and recreate the service again.

```sh
export MCP_DATA_DIR="$previous_snapshot"
docker compose up -d --no-build --pull never --force-recreate --wait
curl --fail http://127.0.0.1:3000/healthz
npm run test:client -- http://127.0.0.1:3000/mcp
```

## Tests

Run `npm test` for the schema, provenance, digest and HTTP tests. The suite uses a synthetic snapshot. The client check in the commands above uses the official MCP SDK and a running Sproutsite snapshot to exercise all three tools in English and German, including example notices.

## License

The server code is available under the [Apache License 2.0](LICENSE). The mounted Sproutsite export retains its original `LICENSE`, `NOTICE` and `THIRD_PARTY_NOTICES.md` unchanged.
