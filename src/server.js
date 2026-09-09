'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const split = line.indexOf('=');
    if (split < 1) continue;
    const key = line.slice(0, split).trim();
    let value = line.slice(split + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    value = value.replace(/%([^%]+)%/g, (_, name) => process.env[name] || '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv(path.join(__dirname, '..', '.env'));

const chains = require('./chains');
const { RpcClient } = require('./rpc-client');
const { ExplorerService } = require('./explorer-service');
const { IndexerClient } = require('./indexer-client');

const clients = Object.fromEntries(Object.entries(chains).map(([id, chain]) => [id, new RpcClient(chain.rpc)]));
const indexers = Object.fromEntries(Object.entries(chains).map(([id, chain]) => [id, new IndexerClient(chain.indexerUrl)]));
const explorer = new ExplorerService(chains, clients, indexers);
const publicDirectory = path.join(__dirname, 'public');
const host = process.env.EXPLORER_HOST || '127.0.0.1';
const preferredPort = Number(process.env.EXPLORER_PORT || 8090);
const requestBuckets = new Map();

function json(res, statusCode, value) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(value));
}

function rateLimited(req) {
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const bucket = requestBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    requestBuckets.set(key, { count: 1, resetAt: now + 60000 });
    return false;
  }
  bucket.count++;
  return bucket.count > 120;
}

function serveFile(res, fileName) {
  const filePath = path.join(publicDirectory, fileName);
  fs.readFile(filePath, (error, data) => {
    if (error) return json(res, 404, { error: 'Not found' });
    const extension = path.extname(filePath);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml'
    };
    res.writeHead(200, {
      'Content-Type': types[extension] || 'application/octet-stream',
      'Cache-Control': ['.html', '.css', '.js'].includes(extension) ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'"
    });
    res.end(data);
  });
}

async function api(req, res, url) {
  if (rateLimited(req)) return json(res, 429, { error: 'Too many requests' });
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length === 2 && parts[1] === 'chains') return json(res, 200, explorer.chainList());
  const chainId = parts[2];
  if (!chainId) return json(res, 404, { error: 'Not found' });

  try {
    if (parts.length === 4 && parts[3] === 'overview') {
      return json(res, 200, await explorer.overview(chainId));
    }
    if (parts.length === 4 && parts[3] === 'blocks') {
      return json(res, 200, await explorer.blocks(chainId, url.searchParams.get('limit')));
    }
    if (parts.length === 5 && parts[3] === 'block') {
      return json(res, 200, await explorer.block(chainId, decodeURIComponent(parts[4])));
    }
    if (parts.length === 5 && parts[3] === 'transaction') {
      return json(res, 200, await explorer.transaction(chainId, decodeURIComponent(parts[4]), url.searchParams.get('blockHash')));
    }
    if (parts.length === 5 && parts[3] === 'address') {
      return json(res, 200, await explorer.address(chainId, decodeURIComponent(parts[4])));
    }
    if (parts.length === 4 && parts[3] === 'address-index') {
      return json(res, 200, explorer.addressIndexStatus(chainId));
    }
    if (parts.length === 4 && parts[3] === 'rich-list') {
      return json(res, 200, await explorer.richList(chainId, url.searchParams.get('limit')));
    }
    if (parts.length === 4 && parts[3] === 'search') {
      return json(res, 200, await explorer.search(chainId, url.searchParams.get('q')));
    }
    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    return json(res, error.statusCode || 502, { error: error.message });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  if (url.pathname === '/health') return json(res, 200, { status: 'ok' });
  const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (requested.includes('..') || path.isAbsolute(requested)) return json(res, 403, { error: 'Forbidden' });
  return serveFile(res, requested);
});

let activePort = preferredPort;
server.on('error', error => {
  if (error.code === 'EADDRINUSE' && activePort < preferredPort + 20) {
    activePort++;
    server.listen(activePort, host);
    return;
  }
  console.error(`Explorer failed to start: ${error.message}`);
  process.exitCode = 1;
});
server.on('listening', () => {
  console.log(`LC2 / DC2 Chain Explorer: http://${host}:${activePort}`);
  console.log('RPC access is read-only, cached, and limited to three concurrent requests per chain.');
});
server.listen(activePort, host);

module.exports = { server, explorer, loadEnv };
