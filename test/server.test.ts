import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { Documentation } from '../src/documentation.js';
import { createHttpServer } from '../src/http.js';
import { loadSnapshot, validateSnapshot } from '../src/snapshot.js';
import { exerciseClient } from './client-smoke.js';
import { fixture as snapshot, fixtureSchema, writeFixture } from './snapshot-fixture.js';

test('rejects unsupported schema versions and validates fields against the supplied schema', () => {
  assert.throws(() => validateSnapshot({ ...snapshot, schemaVersion: 2 }, fixtureSchema),
    /Unsupported Sproutsite snapshot schemaVersion 2\. Supported version: 1/);
  assert.throws(() => validateSnapshot({ ...snapshot, documents: [{ id: 'incomplete' }] }, fixtureSchema),
    /Invalid Sproutsite snapshot: snapshot\/documents\/0/);
});

test('loads an external snapshot and verifies its provenance and notice digests', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sproutsite-mcp-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const lock = writeFixture(directory);
  assert.deepEqual(loadSnapshot(directory), snapshot);

  const lockFile = join(directory, 'snapshot-lock.json');
  for (const mismatch of [{ commit: '2'.repeat(40) }, { sproutsiteVersion: '0.0.2' }]) {
    await writeFile(lockFile, JSON.stringify({ ...lock, ...mismatch }));
    assert.throws(() => loadSnapshot(directory), /does not match the expected provenance/);
  }
  await writeFile(lockFile, JSON.stringify(lock));

  const noticeFile = join(directory, 'snapshot', 'NOTICE');
  await writeFile(noticeFile, 'modified');
  assert.throws(() => loadSnapshot(directory), /NOTICE does not match its SHA-256/);

  const snapshotFile = join(directory, 'snapshot', 'snapshot.json');
  await writeFile(snapshotFile, JSON.stringify({ ...snapshot, source: { ...snapshot.source, dirty: true } }));
  assert.throws(() => loadSnapshot(directory), /must come from a clean Git checkout/);
});

test('serves all tools over Streamable HTTP and checks health, methods and origins', async (t) => {
  const server = createHttpServer(new Documentation(snapshot), '0.1.0');
  server.listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    status: 'ok', sproutsiteVersion: snapshot.sproutsiteVersion, sourceCommit: snapshot.source.commit,
  });
  const endpoint = new URL('/mcp', base);
  const unsupported = await fetch(endpoint);
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get('allow'), 'POST');
  await unsupported.body?.cancel();
  const forbidden = await fetch(endpoint, { method: 'POST', headers: { Origin: 'https://other.example' } });
  assert.equal(forbidden.status, 403);
  await forbidden.body?.cancel();
  await exerciseClient(endpoint, snapshot.sproutsiteVersion);
});
