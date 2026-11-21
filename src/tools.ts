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

function result(data: Record<string, unknown>): CallToolResult {
  return { structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function toolError(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
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
    description: 'Get a Sproutsite page with its original URL, Markdown, examples and their section notices. Pass a page ID or a locale-qualified ID from search.',
    annotations,
    inputSchema: {
      id: z.string().trim().min(1).max(256),
      language: language.optional().describe('Defaults to en for page IDs. A locale-qualified ID supplies its own language unless explicitly overridden.'),
    },
  }, ({ id, language }) => {
    const document = documentation.getDocument(id, language);
    return document ? result(document) : toolError(`No document found for "${id}" in the requested language. Use search_documentation to find an available ID.`);
  });

  server.registerTool('get_component', {
    description: 'Get an exported Sproutsite component and its documented usage, examples, tables and section notices.',
    annotations,
    inputSchema: {
      name: z.string().trim().min(1).max(128).describe('Public component name, for example Accordion.'),
      language: language.default('en'),
    },
  }, ({ name, language }) => {
    const component = documentation.getComponent(name, language);
    return component ? result(component) : toolError(`No documentation found for component "${name}" in language "${language}".`);
  });

  return server;
}
