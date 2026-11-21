import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

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
  } finally {
    await client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const endpoint = new URL(process.argv[2] ?? 'http://127.0.0.1:3000/mcp');
  await exerciseClient(endpoint);
  console.log(`All three MCP tools passed in English and German at ${endpoint.href}`);
}
