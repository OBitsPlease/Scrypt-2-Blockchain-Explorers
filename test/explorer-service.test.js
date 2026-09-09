'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ExplorerService, mapLimit, clamp } = require('../src/explorer-service');
const { READ_ONLY_METHODS } = require('../src/rpc-client');

function fixture() {
  const calls = [];
  const rpc = {
    async call(method, params = []) {
      calls.push([method, params]);
      if (method === 'getblockcount') return 100;
      if (method === 'getblockhash') return String(params[0]).padStart(64, '0');
      if (method === 'getblock') {
        const height = Number(params[0]);
        const txid = `${height}`.padStart(64, 'a');
        const transaction = {
          txid,
          vin: [{ coinbase: '01' }],
          vout: [{ value: 50, scriptPubKey: { type: 'pubkeyhash', address: 'Labc12345678901234567890' } }]
        };
        return {
          hash: params[0],
          height,
          time: 1700000000 + height,
          size: 1000,
          difficulty: 12,
          tx: params[1] === 2 ? [transaction] : [txid]
        };
      }
      if (method === 'getrawtransaction') {
        return {
          txid: params[0],
          blockhash: params[2],
          vin: [{ coinbase: '01' }],
          vout: [{ value: 50, scriptPubKey: { type: 'pubkeyhash', address: 'Labc12345678901234567890' } }]
        };
      }
      if (method === 'getblockchaininfo') return { blocks: 100, headers: 100, verificationprogress: 1 };
      if (method === 'getnetworkinfo') return { connections: 8 };
      if (method === 'getmininginfo') return { difficulty: 12, networkhashps: 1000 };
      if (method === 'getmempoolinfo') return { size: 2, bytes: 400 };
      if (method === 'validateaddress') return { isvalid: true, ismine: false };
      throw new Error(`Unexpected ${method}`);
    }
  };
  const chains = {
    lc2: {
      id: 'lc2',
      symbol: 'LC2',
      name: 'LitecoinII',
      role: 'Parent chain',
      color: '#fff',
      accent: '#000',
      blockTimeSeconds: 150,
      rpc: {}
    }
  };
  return { service: new ExplorerService(chains, { lc2: rpc }), calls };
}

test('block requests are capped and cache repeated reads', async () => {
  const { service, calls } = fixture();
  const first = await service.blocks('lc2', 500);
  const countAfterFirst = calls.length;
  const second = await service.blocks('lc2', 500);

  assert.equal(first.length, 20);
  assert.equal(second, first);
  assert.equal(calls.length, countAfterFirst);
});

test('overview aggregates bounded read-only node data', async () => {
  const { service, calls } = fixture();
  const overview = await service.overview('lc2');

  assert.equal(overview.chain.symbol, 'LC2');
  assert.equal(overview.status.height, 100);
  assert.equal(overview.blocks.length, 16);
  assert.ok(calls.every(([method]) => READ_ONLY_METHODS.has(method)));
  assert.equal(calls.some(([method]) => method === 'scantxoutset'), false);
});

test('address lookup validates and searches only the cached recent window', async () => {
  const { service, calls } = fixture();
  const result = await service.address('lc2', 'Labc12345678901234567890');

  assert.equal(result.isValid, true);
  assert.equal(result.limitedHistory, true);
  assert.equal(result.recentTransactions.length > 0, true);
  assert.equal(calls.some(([method]) => method === 'scantxoutset'), false);
});

test('rich list reports unavailable without scanning the mining node', async () => {
  const { service, calls } = fixture();
  const result = await service.richList('lc2', 100);

  assert.equal(result.available, false);
  assert.equal(result.connected, false);
  assert.deepEqual(result.entries, []);
  assert.equal(calls.length, 0);
});

test('configured external index supplies wallet details and rich list', async () => {
  const { service, calls } = fixture();
  service.indexers.lc2 = {
    configured: true,
    address: async address => ({ balance: 125, transactionCount: 4, address }),
    richList: async limit => ({ entries: [{ address: 'Lrich', balance: 500, limit }] })
  };

  const address = await service.address('lc2', 'Labc12345678901234567890');
  const richList = await service.richList('lc2', 25);

  assert.equal(address.indexed, true);
  assert.equal(address.balance, 125);
  assert.equal(richList.available, true);
  assert.equal(richList.entries[0].balance, 500);
  assert.deepEqual(calls.map(([method]) => method), ['validateaddress']);
});

test('helpers enforce bounds and concurrency', async () => {
  let active = 0;
  let maximum = 0;
  const output = await mapLimit([1, 2, 3, 4, 5], 2, async value => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return value * 2;
  });

  assert.deepEqual(output, [2, 4, 6, 8, 10]);
  assert.equal(maximum, 2);
  assert.equal(clamp(500, 1, 20), 20);
});
