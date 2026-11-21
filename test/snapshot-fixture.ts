import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSnapshotLock, readExport, type Document, type Snapshot } from '../src/snapshot.js';

function page(pageId: string, locale: 'en' | 'de', title: string, notice?: string): Document {
  const markdown = [title, notice].filter(Boolean).join('\n');
  return {
    id: `${pageId}:${locale}`,
    pageId,
    kind: pageId.startsWith('showcase/') ? 'showcase' : 'documentation',
    locale,
    url: `https://example.test/${locale}/${pageId}/`,
    title,
    heading: title,
    description: title,
    markdown,
    searchText: markdown,
    translations: [],
    sections: [{
      id: '01-guide',
      markdown,
      imports: [],
      headings: [],
      examples: [{ language: 'astro', code: '<Example />', sha256: '0'.repeat(64) }],
      tables: [],
      notices: notice ? [{ kind: 'alert', text: notice }] : [],
      unresolvedExpressions: [],
    }],
  };
}

const source = {
  repository: 'https://example.test/sproutsite',
  commit: '1'.repeat(40),
  dirty: false,
};

export const fixture: Snapshot = {
  schemaVersion: 1,
  sproutsiteVersion: '0.0.1',
  source,
  defaultLocale: 'en',
  locales: ['en', 'de'],
  documents: [
    page('showcase/accordions', 'en', 'Accordions'),
    page('showcase/accordions', 'de', 'Akkordeons'),
    page('documentation/getting-started/your-website/hero', 'en', 'Hero', 'Partly available'),
    page('documentation/getting-started/your-website/forms', 'de', 'Formulare', 'Offen'),
    page('documentation/getting-started/your-website/header-and-footer', 'en', 'Header and footer'),
  ],
  components: [
    {
      name: 'Accordion',
      importPath: 'sproutsite/components',
      documents: [{ locale: 'en', id: 'showcase/accordions:en' }, { locale: 'de', id: 'showcase/accordions:de' }],
    },
    {
      name: 'DefaultHeader',
      importPath: 'sproutsite/components',
      documents: [{ locale: 'en', id: 'documentation/getting-started/your-website/header-and-footer:en' }],
    },
  ],
};

export const fixtureSchema = {
  type: 'object',
  properties: {
    documents: {
      type: 'array',
      items: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
    },
  },
  required: ['documents'],
};

export function writeFixture(directory: string) {
  const bundle = join(directory, 'snapshot');
  mkdirSync(bundle);
  writeFileSync(join(bundle, 'snapshot.json'), JSON.stringify(fixture));
  writeFileSync(join(bundle, 'schema.json'), JSON.stringify(fixtureSchema));
  for (const file of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
    writeFileSync(join(bundle, file), `Test fixture ${file}\n`);
  }
  const lock = createSnapshotLock(readExport(bundle), {
    commit: source.commit,
    repository: source.repository,
    sproutsiteVersion: fixture.sproutsiteVersion,
  });
  writeFileSync(join(directory, 'snapshot-lock.json'), JSON.stringify(lock));
  return lock;
}
