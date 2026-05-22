#!/usr/bin/env node

/**
 * mcp-reverse CLI — Proxy Mode
 *
 * Start a reverse proxy gateway that enables standard MCP clients
 * (supporting only StreamableHTTP) to communicate with internal
 * MCP servers behind NAT/firewall via SSE reverse connections.
 *
 * Usage:
 *   npx mcp-reverse proxy --name my-server --token sk-abc123
 *   npx mcp-reverse proxy --name my-server --token sk-abc123 --port 3000
 */

import { ReverseProxy } from './proxy/index.js';
import type { ProxyConfig } from './proxy/index.js';
import { consoleLogger } from './protocol/types.js';

// ─── Help ─────────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
mcp-reverse proxy — MCP Reverse Proxy Gateway

Starts a single-port HTTP server that bridges:
  MCP Client (StreamableHTTP)  ←→  Internal MCP Server (Reverse SSE)

Usage:
  mcp-reverse proxy --name <name> --token <token> [options]
  npx mcp-reverse proxy --name <name> --token <token> [options]

Required:
  --name,  -n    Server name — the expected internal MCP server identifier
  --token, -t    Auth token  — shared secret the internal server must present

Options:
  --port,  -p    HTTP port to listen on (default: 3000)
  --host         Host address to bind to (default: 0.0.0.0)
  --mcp-path     StreamableHTTP endpoint path (default: /mcp)
  --help         Show this help message

Environment variables (fallback):
  MCP_REVERSE_NAME      Server name
  MCP_REVERSE_TOKEN     Auth token
  MCP_REVERSE_PORT      HTTP port
  MCP_REVERSE_HOST      Bind host
  MCP_REVERSE_MCP_PATH  MCP endpoint path

Examples:
  $ npx mcp-reverse proxy -n office-server -t sk-abc123
  $ npx mcp-reverse proxy -n office-server -t sk-abc123 -p 8080 --host 127.0.0.1
  $ MCP_REVERSE_NAME=office MCP_REVERSE_TOKEN=sk-abc npx mcp-reverse proxy

Endpoints:
  /mcp           MCP client connects here (StreamableHTTP)
  /mcp/reverse/sse    Internal server reverse SSE connection (GET, requires auth)
  /mcp/reverse/message Internal server message delivery (POST)
`);
}

// ─── Arg Parsing ──────────────────────────────────────────────────────

function parseArgs(raw: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  const flagMap: Record<string, string> = {
    '--name': 'name',
    '-n': 'name',
    '--token': 'token',
    '-t': 'token',
    '--port': 'port',
    '-p': 'port',
    '--host': 'host',
    '--mcp-path': 'mcpPath',
  };

  for (let i = 0; i < raw.length; i++) {
    const mapped = flagMap[raw[i]];
    if (mapped && i + 1 < raw.length && !raw[i + 1].startsWith('-')) {
      result[mapped] = raw[i + 1];
      i++;
    }
  }

  return result;
}

function buildConfig(): ProxyConfig {
  // Check for --help anywhere
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const raw = process.argv.slice(2);
  // Support optional "proxy" subcommand
  const args = raw[0] === 'proxy' ? raw.slice(1) : raw;
  const parsed = parseArgs(args);

  return {
    name: parsed.name || process.env.MCP_REVERSE_NAME || '',
    token: parsed.token || process.env.MCP_REVERSE_TOKEN || '',
    port: parsed.port ? parseInt(parsed.port, 10) : process.env.MCP_REVERSE_PORT ? parseInt(process.env.MCP_REVERSE_PORT, 10) : undefined,
    host: parsed.host || process.env.MCP_REVERSE_HOST || undefined,
    mcpPath: parsed.mcpPath || process.env.MCP_REVERSE_MCP_PATH || undefined,
  };
}

// ─── CLI Errors ───────────────────────────────────────────────────────

class CLIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CLIError';
  }
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = buildConfig();

  // Validate required fields
  if (!config.name) {
    throw new CLIError('--name (or MCP_REVERSE_NAME) is required');
  }
  if (!config.token) {
    throw new CLIError('--token (or MCP_REVERSE_TOKEN) is required');
  }

  const proxy = new ReverseProxy(config, consoleLogger);

  // Graceful shutdown
  const shutdown = async () => {
    consoleLogger.info('\nShutting down...');
    await proxy.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await proxy.start();
}

main().catch((err) => {
  if (err instanceof CLIError) {
    console.error(`\nError: ${err.message}\n`);
    console.error('Run with --help for usage information.\n');
  } else {
    console.error(`\nFatal error: ${(err as Error).message}\n`);
  }
  process.exit(1);
});
