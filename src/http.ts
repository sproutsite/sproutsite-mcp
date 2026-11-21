import { readFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Documentation } from './documentation.js';
import { createMcpServer } from './tools.js';

function json(response: ServerResponse, status: number, body: object) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function rpcError(response: ServerResponse, status: number, code: number, message: string) {
  json(response, status, { jsonrpc: '2.0', id: null, error: { code, message } });
}

const landingFiles = [
  ['/', 'index.html', 'text/html; charset=utf-8'],
  ['/assets/sproutsite-mcp.css', 'assets/sproutsite-mcp.css', 'text/css; charset=utf-8'],
  ['/assets/sproutsite-logo.svg', 'assets/sproutsite-logo.svg', 'image/svg+xml'],
  ['/assets/sproutsite-wave.svg', 'assets/sproutsite-wave.svg', 'image/svg+xml'],
  ['/assets/nunito-latin-variable.woff2', 'assets/nunito-latin-variable.woff2', 'font/woff2'],
  ['/assets/eb-garamond-latin-variable.woff2', 'assets/eb-garamond-latin-variable.woff2', 'font/woff2'],
] as const;

export function createHttpServer(documentation: Documentation, version: string) {
  const landing = new Map<string, { body: Buffer; type: string }>(
    landingFiles.map(([path, file, type]) => [
      path, { body: readFileSync(new URL(`../../public/${file}`, import.meta.url)), type },
    ]),
  );
  const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, async (request, response) => {
    const path = request.url?.split('?', 1)[0];
    const page = path && landing.get(path);
    if (page && (request.method === 'GET' || request.method === 'HEAD')) {
      response.writeHead(200, {
        'Content-Type': page.type,
        'Content-Length': page.body.length,
        'Cache-Control': 'no-cache',
        'Content-Security-Policy': "default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : page.body);
      return;
    }
    if (path === '/healthz' && request.method === 'GET') {
      json(response, 200, {
        status: 'ok',
        sproutsiteVersion: documentation.version,
        sourceCommit: documentation.sourceCommit,
      });
      return;
    }
    if (path !== '/mcp') {
      json(response, 404, { error: 'Not found' });
      return;
    }

    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 3000;
    const origin = request.headers.origin;
    if (origin !== undefined &&
        origin !== 'https://mcp.sproutsite.dev' &&
        origin !== `http://127.0.0.1:${port}` &&
        origin !== `http://localhost:${port}` &&
        origin !== `http://[::1]:${port}`) {
      rpcError(response, 403, -32000, 'Origin is not allowed.');
      return;
    }

    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      rpcError(response, 405, -32000, 'Method not allowed.');
      return;
    }

    const mcp = createMcpServer(documentation, version);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: 64 * 1024,
    });
    response.setHeader('Cache-Control', 'no-store');
    response.once('close', () => {
      void mcp.close().catch(console.error);
    });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(request, response);
    } catch (error) {
      console.error('MCP request failed:', error);
      if (!response.headersSent) {
        rpcError(response, 500, -32603, 'Internal server error.');
      } else {
        response.destroy();
      }
    }
  });
  return server;
}
