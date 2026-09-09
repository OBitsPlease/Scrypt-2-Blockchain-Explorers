'use strict';

const http = require('node:http');
const https = require('node:https');

class IndexerClient {
  constructor(baseUrl) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
  }

  get configured() {
    return Boolean(this.baseUrl);
  }

  get(pathname) {
    if (!this.configured) {
      return Promise.reject(Object.assign(new Error('No external address index is configured'), { statusCode: 503 }));
    }
    const url = new URL(`${this.baseUrl}${pathname}`);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return Promise.reject(Object.assign(new Error('Address index URL must use HTTP or HTTPS'), { statusCode: 500 }));
    }
    const transport = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const request = transport.get(url, {
        timeout: 8000,
        headers: { Accept: 'application/json' }
      }, response => {
        let payload = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          payload += chunk;
          if (payload.length > 5 * 1024 * 1024) request.destroy(new Error('Address index response exceeded safety limit'));
        });
        response.on('end', () => {
          if (response.statusCode >= 400) {
            reject(Object.assign(new Error(`Address index HTTP ${response.statusCode}`), { statusCode: 502 }));
            return;
          }
          try {
            resolve(JSON.parse(payload));
          } catch (error) {
            reject(Object.assign(new Error(`Invalid address index response: ${error.message}`), { statusCode: 502 }));
          }
        });
      });
      request.on('timeout', () => request.destroy(new Error('Address index request timed out')));
      request.on('error', reject);
    });
  }

  address(address) {
    return this.get(`/address/${encodeURIComponent(address)}`);
  }

  richList(limit) {
    return this.get(`/rich-list?limit=${encodeURIComponent(limit)}`);
  }
}

module.exports = { IndexerClient };
