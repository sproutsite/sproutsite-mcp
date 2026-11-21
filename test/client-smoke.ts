import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema, type CallToolResult, type TextContent } from '@modelcontextprotocol/sdk/types.js';
import type { Document } from '../src/snapshot.js';

type FullRetrieval = Pick<Document, 'title' | 'description' | 'url' | 'markdown' | 'sections'> & {
  language: string;
  sproutsiteVersion: string;
};

function textContent({ content }: Pick<CallToolResult, 'content'>): string {
  return content.filter((item): item is TextContent => item.type === 'text').map((item) => item.text).join('\n');
}

async function exerciseRetrievalViews(client: Client) {
  async function call(name: string, args: Record<string, unknown>) {
    return CallToolResultSchema.parse(await client.callTool({ name, arguments: args }));
  }

  for (const language of ['en', 'de']) {
    for (const [name, selector] of [
      ['get_document', { id: 'showcase/layout' }],
      ['get_component', { name: 'Columns' }],
    ] as const) {
      const args = { ...selector, language };
      const full = await call(name, args);
      assert.equal(full.isError, undefined);
      const legacy: FullRetrieval = JSON.parse(textContent(full));
      assert.deepEqual(full.structuredContent, legacy);
      assert.equal(legacy.language, language);
      assert.equal(typeof legacy.markdown, 'string');
      const sectionId = '08-dividers';
      const original = legacy.sections.find((section) => section.id === sectionId);
      assert.ok(original);

      const overview = await call(name, { ...args, view: 'summary' });
      assert.equal(overview.isError, undefined);
      const overviewText = textContent(overview);
      const summary = overview.structuredContent;
      assert.equal(summary?.view, 'summary');
      assert.equal(summary?.url, legacy.url);
      assert.equal(summary?.language, language);
      assert.equal(summary?.sproutsiteVersion, legacy.sproutsiteVersion);
      assert.equal(summary?.title, legacy.title);
      assert.equal(summary?.description, legacy.description);
      assert.equal(summary?.markdown, undefined);
      assert.ok(Array.isArray(summary?.sections));
      assert.deepEqual(summary.sections.map(({ id }) => id), legacy.sections.map(({ id }) => id));
      for (const section of summary.sections) {
        assert.ok(overviewText.includes(`\`${section.id}\` — ${section.heading}`));
        assert.equal(section.markdown, undefined);
      }
      assert.ok(overviewText.includes(legacy.title) && overviewText.includes(legacy.description));
      assert.ok(overviewText.includes(` · ${language} · Sproutsite ${legacy.sproutsiteVersion}`));
      assert.ok(overviewText.includes(legacy.url));

      const selected = await call(name, { ...args, sectionId });
      assert.equal(selected.isError, undefined);
      const selectedText = textContent(selected);
      const sectionResult = selected.structuredContent;
      const heading = original.headings[0];
      assert.ok(heading?.anchor);
      const url = new URL(legacy.url);
      url.hash = heading.anchor;
      assert.equal(sectionResult?.view, 'section');
      assert.equal(sectionResult?.url, url.href);
      assert.equal(sectionResult?.language, language);
      assert.equal(sectionResult?.sproutsiteVersion, legacy.sproutsiteVersion);
      assert.equal(sectionResult?.sections, undefined);
      assert.deepEqual(sectionResult?.section, { ...original, heading: heading.text });
      assert.ok(original.imports.length && original.examples.length && original.tables.length);
      assert.ok(selectedText.includes(`Section: \`${sectionId}\``));
      assert.ok(selectedText.includes(url.href));
      assert.ok(selectedText.includes(` · ${language} · Sproutsite ${legacy.sproutsiteVersion}`));
      assert.ok(selectedText.includes(original.markdown));
      for (const statement of original.imports) assert.ok(selectedText.includes(statement));
      for (const example of original.examples) assert.ok(selectedText.includes(example.code));
      for (const table of original.tables) {
        for (const heading of table.headers) assert.ok(selectedText.includes(heading));
      }
      if (name === 'get_component') {
        assert.equal(summary?.name, 'Columns');
        assert.equal(sectionResult?.importPath, 'sproutsite/components');
        assert.ok(selectedText.includes('sproutsite/components'));
      }

      const missing = await call(name, { ...args, sectionId: 'unknown' });
      assert.equal(missing.isError, true);
      assert.match(textContent(missing), /Unknown section ID "unknown".*view: "summary"/);
      const conflicting = await call(name, { ...args, sectionId, view: 'summary' });
      assert.equal(conflicting.isError, true);
    }

    const args = { id: 'documentation/getting-started/your-website/hero', language };
    const overview = await call('get_document', { ...args, view: 'summary' });
    const hero = await call('get_document', { ...args, sectionId: 'hero' });
    assert.equal(hero.isError, undefined);
    assert.equal(hero.structuredContent?.url, overview.structuredContent?.url);
    const guide = await call('get_document', { ...args, sectionId: '01-guide' });
    assert.equal(guide.isError, undefined);
    assert.match(textContent(guide), language === 'en' ? /Partly available/ : /Teilweise möglich/);
  }
}

export async function exerciseClient(endpoint: URL, expectedVersion?: string) {
  const client = new Client({ name: 'sproutsite-mcp-smoke-test', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(endpoint));
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
      'get_component', 'get_document', 'search_documentation',
    ]);
    assert.ok(tools.every((tool) => tool.annotations?.readOnlyHint === true));

    async function call(name: string, args: Record<string, unknown>) {
      const response = await client.callTool({ name, arguments: args });
      assert.equal(response.isError, undefined, JSON.stringify(response.content));
      assert.ok(response.structuredContent);
      const payload = response.structuredContent as Record<string, unknown>;
      assert.match(String(payload.sproutsiteVersion), /^\d+\.\d+\.\d+/);
      if (expectedVersion) assert.equal(payload.sproutsiteVersion, expectedVersion);
      return payload;
    }

    const english = await call('search_documentation', { query: 'Accordion', limit: 1 });
    assert.equal(english.language, 'en');
    assert.ok(Array.isArray(english.results));
    assert.equal(english.results.length, 1);
    assert.equal(english.results[0].id, 'showcase/accordions:en');
    assert.equal(english.results[0].language, 'en');
    assert.equal(english.results[0].sproutsiteVersion, english.sproutsiteVersion);
    assert.match(english.results[0].url, /^https:\/\//);

    const german = await call('search_documentation', { query: 'Accordion', language: 'de', limit: 3 });
    assert.equal(german.language, 'de');
    assert.ok(Array.isArray(german.results) && german.results.length > 0);
    assert.ok(german.results.every((entry) => entry.language === 'de'));
    assert.equal(german.results[0].id, 'showcase/accordions:de');

    const document = await call('get_document', { id: english.results[0].id });
    assert.equal(document.language, 'en');
    assert.equal(document.url, english.results[0].url);
    assert.match(String(document.markdown), /Accordion/);

    const translation = await call('get_document', { id: document.id, language: 'de' });
    assert.equal(translation.language, 'de');
    assert.equal(translation.url, german.results[0].url);

    const hero = await call('get_document', { id: 'documentation/getting-started/your-website/hero' });
    assert.equal(hero.language, 'en');
    assert.ok(Array.isArray(hero.sections));
    const guide = hero.sections.find((section) => section.id === '01-guide');
    assert.ok(guide?.examples.length > 0);
    assert.ok(guide?.notices.some((notice: { text: string }) => notice.text.includes('Partly available')));
    assert.match(guide.markdown, /Partly available/);

    const open = await call('get_document', {
      id: 'documentation/getting-started/your-website/forms',
      language: 'de',
    });
    assert.match(String(open.markdown), /Offen/);

    const component = await call('get_component', { name: 'Accordion', language: 'de' });
    assert.equal(component.name, 'Accordion');
    assert.equal(component.importPath, 'sproutsite/components');
    assert.equal(component.language, 'de');
    assert.equal(component.url, translation.url);
    assert.ok(Array.isArray(component.sections) && component.sections.some((section) => section.examples.length > 0));
    const defaultComponent = await call('get_component', { name: 'DefaultHeader' });
    assert.equal(defaultComponent.language, 'en');
    assert.equal(defaultComponent.id, 'documentation/getting-started/your-website/header-and-footer:en');

    const empty = await call('search_documentation', { query: 'unfindablexyz123' });
    assert.deepEqual(empty.results, []);
    const missing = await client.callTool({ name: 'get_component', arguments: { name: 'NotAnExport' } });
    assert.equal(missing.isError, true);
    const invalid = await client.callTool({
      name: 'get_document', arguments: { id: document.id, language: 'fr' },
    });
    assert.equal(invalid.isError, true);
    await exerciseRetrievalViews(client);
  } finally {
    await client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const endpoint = new URL(process.argv[2] ?? 'http://127.0.0.1:3000/mcp');
  await exerciseClient(endpoint);
  console.log(`All three MCP tools passed in English and German at ${endpoint.href}`);
}
