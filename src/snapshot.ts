import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import formats from 'ajv-formats';
import { z } from 'zod';

export const languages = ['en', 'de'] as const;
export type Language = (typeof languages)[number];

interface Translation {
  locale: string;
  id: string;
  url: string;
}

interface Section {
  id: string;
  markdown: string;
  imports: string[];
  headings: { depth: number; text: string; anchor?: string }[];
  examples: { language: string; code: string; sha256: string }[];
  tables: { headers: string[]; rows: string[][] }[];
  notices: { kind: 'alert' | 'badge'; text: string; variant?: string }[];
  unresolvedExpressions: string[];
}

export interface Document {
  id: string;
  pageId: string;
  kind: 'documentation' | 'showcase';
  locale: string;
  title: string;
  heading: string;
  description: string;
  url: string;
  markdown: string;
  searchText: string;
  translations: Translation[];
  sections: Section[];
}

export interface Snapshot {
  schemaVersion: 1;
  sproutsiteVersion: string;
  source: { repository: string; commit: string | null; dirty: boolean | null };
  defaultLocale: string;
  locales: string[];
  documents: Document[];
  components: {
    name: string;
    importPath: string;
    documents: { locale: string; id: string }[];
  }[];
}

export const noticeFiles = ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md'] as const;
export const snapshotFiles = ['snapshot.json', 'schema.json', ...noticeFiles] as const;
export const gitCommitPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

type ExportFiles = Record<(typeof snapshotFiles)[number], Buffer>;

const lockSchema = z.strictObject({
  repository: z.string().url(),
  commit: z.string().regex(gitCommitPattern),
  sproutsiteVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
  sha256: z.record(z.enum(snapshotFiles), z.string().regex(/^[a-f0-9]{64}$/)),
});
type SnapshotLock = z.infer<typeof lockSchema>;

export function readExport(directory: string): ExportFiles {
  return Object.fromEntries(snapshotFiles.map((file) => [file, readFileSync(join(directory, file))])) as ExportFiles;
}

export function createSnapshotLock(contents: ExportFiles, source: Omit<SnapshotLock, 'sha256'>): SnapshotLock {
  const sha256 = Object.fromEntries(snapshotFiles.map((file) => [file, digest(contents[file])]));
  return lockSchema.parse({ ...source, sha256 });
}

function digest(content: Buffer) {
  return createHash('sha256').update(content).digest('hex');
}

export function validateSnapshot(data: unknown, schema: object): Snapshot {
  const version = data && typeof data === 'object' && 'schemaVersion' in data
    ? data.schemaVersion
    : undefined;
  if (version !== 1) {
    throw new Error(`Unsupported Sproutsite snapshot schemaVersion ${JSON.stringify(version)}. Supported version: 1.`);
  }

  const ajv = new Ajv2020();
  formats.default(ajv);
  const validate = ajv.compile<Snapshot>(schema);
  if (!validate(data)) {
    throw new Error(`Invalid Sproutsite snapshot: ${ajv.errorsText(validate.errors, { dataVar: 'snapshot' })}`);
  }
  return data;
}

export function validateLockedSnapshot(contents: ExportFiles, lock: SnapshotLock): Snapshot {
  const snapshot = validateSnapshot(
    JSON.parse(contents['snapshot.json'].toString('utf8')),
    JSON.parse(contents['schema.json'].toString('utf8')),
  );

  if (snapshot.source.dirty !== false) {
    throw new Error('The Sproutsite snapshot must come from a clean Git checkout (source.dirty must be false).');
  }
  if (snapshot.source.commit !== lock.commit ||
      snapshot.source.repository !== lock.repository ||
      snapshot.sproutsiteVersion !== lock.sproutsiteVersion) {
    throw new Error('Sproutsite snapshot repository, Git commit or Sproutsite version does not match the expected provenance.');
  }

  for (const file of snapshotFiles) {
    if (digest(contents[file]) !== lock.sha256[file]) {
      throw new Error(`Snapshot file ${file} does not match its SHA-256 in snapshot-lock.json.`);
    }
  }

  if (!languages.every((language) => snapshot.locales.includes(language))) {
    throw new Error('The Sproutsite snapshot must include English (en) and German (de).');
  }
  return snapshot;
}

export function loadSnapshot(dataDirectory: string): Snapshot {
  const lock = lockSchema.parse(JSON.parse(readFileSync(join(dataDirectory, 'snapshot-lock.json'), 'utf8')));
  return validateLockedSnapshot(readExport(join(dataDirectory, 'snapshot')), lock);
}
