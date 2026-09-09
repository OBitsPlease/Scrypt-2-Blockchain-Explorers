'use strict';

const fs = require('node:fs');
const http = require('node:http');

const READ_ONLY_METHODS = new Set([
  'getblockchaininfo',
  'getnetworkinfo',
  'getmininginfo',
  'getmempoolinfo',
  'getblockcount',
  'getblockhash',
  'getblock',
  'getrawtransaction',
  'validateaddress'
]);

class RpcClient {
  constructor(options) {
    this.options = options;
    this.id = 0;
    this.agent = new http.Agent({ keepAlive: true, maxSockets: 3 });
    this.confAuth = this.readConfAuth();
  }

  readConfAuth() {
    if (!this.options.confFile || !fs.existsSync(this.options.confFile)) return null;
    const values = {};
    for (const rawLine of fs.readFileSync(this.options.confFile, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim().toLowerCase();
      if ((key === 'rpcuser' || key === 'rpcpassword') && values[key] == null) {
        values[key] = line.slice(separator + 1).trim();
      }
      if (values.rpcuser != null && values.rpcpassword != null) break;
    }
    return values.rpcuser != null && values.rpcpassword != null
      ? Buffer.from(`${values.rpcuser}:${values.rpcpassword}`).toString('base64')
      : null;
  }

  auth() {
    const cookieFile = this.options.cookieFile;
    if (cookieFile && fs.existsSync(cookieFile)) {
      const cookie = fs.readFileSync(cookieFile, 'utf8').trim();
      if (cookie.includes(':')) return Buffer.from(cookie).toString('base64');
    }
    if (!this.options.user && !this.options.password && this.confAuth) return this.confAuth;
    return Buffer.from(`${this.options.user || ''}:${this.options.password || ''}`).toString('base64');
  }

  call(method, params = []) {
    if (!READ_ONLY_METHODS.has(method)) {
      return Promise.reject(new Error(`RPC method is not permitted: ${method}`));
    }

    const body = JSON.stringify({ jsonrpc: '1.0', id: ++this.id, method, params });
    return new Promise((resolve, reject) => {
      const request = http.request({
        host: this.options.host,
        port: this.options.port,
        method: 'POST',
        path: '/',
        agent: this.agent,
        headers: {
          Authorization: `Basic ${this.auth()}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, response => {
        let payload = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          payload += chunk;
          if (payload.length > 10 * 1024 * 1024) request.destroy(new Error('RPC response exceeded safety limit'));
        });
        response.on('end', () => {
          if (response.statusCode >= 400) {
            reject(new Error(`RPC HTTP ${response.statusCode}`));
            return;
          }
          try {
            const parsed = JSON.parse(payload);
            if (parsed.error) reject(new Error(`RPC ${parsed.error.code}: ${parsed.error.message}`));
            else resolve(parsed.result);
          } catch (error) {
            reject(new Error(`Invalid RPC response: ${error.message}`));
          }
        });
      });
      request.setTimeout(8000, () => request.destroy(new Error(`RPC timeout calling ${method}`)));
      request.on('error', reject);
      request.end(body);
    });
  }
}

module.exports = { RpcClient, READ_ONLY_METHODS };
