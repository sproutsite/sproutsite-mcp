import { readFileSync } from 'node:fs';
import { Documentation } from './documentation.js';
import { createHttpServer } from './http.js';
import { loadSnapshot } from './snapshot.js';

function main() {
  const dataDirectory = process.env.MCP_DATA_DIR;
  if (!dataDirectory) {
    throw new Error('Set MCP_DATA_DIR to a prepared directory containing snapshot-lock.json and snapshot/.');
  }
  const snapshot = loadSnapshot(dataDirectory);
  if (process.argv[2] === '--verify-snapshot') {
    console.log(`Verified Sproutsite ${snapshot.sproutsiteVersion} snapshot from ${snapshot.source.commit}.`);
    return;
  }

  const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const port = Number(process.env.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535.');
  }

  const host = process.env.HOST ?? '127.0.0.1';
  const server = createHttpServer(new Documentation(snapshot), version);
  server.on('error', (error) => {
    console.error(`sproutsite-mcp: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, host, () => {
    console.log(`sproutsite-mcp listening on ${host}:${port} with Sproutsite ${snapshot.sproutsiteVersion} documentation.`);
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => server.close());
  }
}

try {
  main();
} catch (error) {
  console.error(`sproutsite-mcp: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
