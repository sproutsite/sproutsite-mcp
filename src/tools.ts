import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Documentation } from './documentation.js';
import { languages } from './snapshot.js';

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const language = z.enum(languages).describe('Language of the documentation: en or de.');
const retrievalOptions = {
  view: z.literal('summary').optional().describe('Return a short overview with section IDs and headings. Omit for full retrieval.'),
  sectionId: z.string().trim().min(1).optional().describe('Return only the section with this ID from the summary. Use without view.'),
};

function result(data: Record<string, unknown>, text = JSON.stringify(data)): CallToolResult {
  return { structuredContent: data, content: [{ type: 'text', text }] };
}

function toolError(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

function retrievalResult(data: NonNullable<ReturnType<Documentation['getDocument']>>): CallToolResult {
  if (data.error !== undefined) return toolError(data.error);
  if (!('view' in data)) return result(data);

  const title = data.name ? `${data.name} — ${data.title}` : data.title;
  const metadata = [`# ${title}`, `${data.id} · ${data.language} · Sproutsite ${data.sproutsiteVersion}`, data.url];
  if (data.importPath) metadata.push(`Import path: \`${data.importPath}\``);
  const header = metadata.join('\n');

  if (data.view === 'summary') {
    const sections = data.sections.map(({ id, heading }) => `- \`${id}\` — ${heading}`).join('\n');
    return result(data, [header, data.description, sections].filter(Boolean).join('\n\n'));
  }

  const { id, imports, markdown } = data.section;
  // Exported Markdown already preserves the examples, tables and notices in context.
  const text = [`${header}\nSection: \`${id}\``, markdown];
  if (imports.length) text.push(`Imports\n~~~js\n${imports.join('\n')}\n~~~`);
  return result(data, text.filter(Boolean).join('\n\n'));
}

export function createMcpServer(documentation: Documentation, version: string): McpServer {
  const server = new McpServer({ name: 'sproutsite-mcp', version });

  server.registerTool('search_documentation', {
    description: 'Search Sproutsite documentation and showcase pages by keywords. Use a result ID to retrieve the full guide and its examples.',
    annotations,
    inputSchema: {
      query: z.string().trim().min(1).max(256),
      language: language.default('en'),
      limit: z.number().int().min(1).max(20).default(5),
    },
  }, ({ query, language, limit }) => result({
    language,
    sproutsiteVersion: documentation.version,
    results: documentation.search(query, language, limit),
  }));

  server.registerTool('get_document', {
    description: 'Get a Sproutsite page by ID. Use view: "summary" to discover section IDs, then sectionId to fetch one section with its examples and notices. Omit both for the full page.',
    annotations,
    inputSchema: {
      id: z.string().trim().min(1).max(256),
      language: language.optional().describe('Defaults to en for page IDs. A locale-qualified ID supplies its own language unless explicitly overridden.'),
      ...retrievalOptions,
    },
  }, ({ id, language, view, sectionId }) => {
    const document = documentation.getDocument(id, language, { view, sectionId });
    return document ? retrievalResult(document) : toolError(`No document found for "${id}" in the requested language. Use search_documentation to find an available ID.`);
  });

  server.registerTool('get_component', {
    description: 'Get an exported Sproutsite component and its guide. Use view: "summary" to discover section IDs, then sectionId to fetch one section with its examples, tables and notices. Omit both for the full guide.',
    annotations,
    inputSchema: {
      name: z.string().trim().min(1).max(128).describe('Public component name, for example Accordion.'),
      language: language.default('en'),
      ...retrievalOptions,
    },
  }, ({ name, language, view, sectionId }) => {
    const component = documentation.getComponent(name, language, { view, sectionId });
    return component ? retrievalResult(component) : toolError(`No documentation found for component "${name}" in language "${language}".`);
  });

  return server;
}
