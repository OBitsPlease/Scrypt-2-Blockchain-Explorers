'use strict';

const HEX_64 = /^[a-f0-9]{64}$/i;
const ADDRESS = /^[a-zA-Z0-9]{20,100}$/;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || minimum));
}

function sumOutputs(transaction) {
  return (transaction.vout || []).reduce((total, output) => total + Number(output.value || 0), 0);
}

function outputAddresses(transaction) {
  return [...new Set((transaction.vout || []).flatMap(output => {
    const script = output.scriptPubKey || {};
    return script.address ? [script.address] : (script.addresses || []);
  }))];
}

async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

class ExplorerService {
  constructor(chains, clients, indexers = {}) {
    this.chains = chains;
    this.clients = clients;
    this.indexers = indexers;
    this.cache = new Map();
  }

  chainList() {
    return Object.values(this.chains).map(({ rpc, indexerUrl, ...chain }) => ({
      ...chain,
      addressIndexConnected: Boolean(this.indexers[chain.id]?.configured)
    }));
  }

  resolve(chainId) {
    const chain = this.chains[chainId];
    const rpc = this.clients[chainId];
    if (!chain || !rpc) throw Object.assign(new Error('Unknown chain'), { statusCode: 404 });
    return { chain, rpc };
  }

  cached(key, ttlMs, producer) {
    const now = Date.now();
    const existing = this.cache.get(key);
    if (existing && existing.expires > now) return existing.promise;
    const promise = Promise.resolve().then(producer).catch(error => {
      this.cache.delete(key);
      throw error;
    });
    this.cache.set(key, { expires: now + ttlMs, promise });
    return promise;
  }

  async blocks(chainId, requestedLimit = 12) {
    const limit = clamp(requestedLimit, 1, 20);
    return this.cached(`blocks:${chainId}:${limit}`, 12000, async () => {
      const { rpc } = this.resolve(chainId);
      const height = await rpc.call('getblockcount');
      const heights = Array.from({ length: Math.min(limit, height + 1) }, (_, index) => height - index);
      return mapLimit(heights, 3, async blockHeight => {
        const hash = await rpc.call('getblockhash', [blockHeight]);
        const block = await rpc.call('getblock', [hash, 1]);
        return this.normalizeBlock(block, blockHeight);
      });
    });
  }

  normalizeBlock(block, fallbackHeight) {
    return {
      hash: block.hash,
      height: Number(block.height ?? fallbackHeight),
      confirmations: Number(block.confirmations || 0),
      time: Number(block.time || 0),
      size: Number(block.size || block.strippedsize || 0),
      weight: Number(block.weight || 0),
      difficulty: Number(block.difficulty || 0),
      nonce: Number(block.nonce || 0),
      version: Number(block.version || 0),
      previousHash: block.previousblockhash || null,
      nextHash: block.nextblockhash || null,
      txids: Array.isArray(block.tx) ? block.tx.map(tx => typeof tx === 'string' ? tx : tx.txid) : [],
      transactionCount: Array.isArray(block.tx) ? block.tx.length : Number(block.nTx || 0)
    };
  }

  async recentTransactions(chainId, blocks) {
    return this.cached(`transactions:${chainId}:${blocks[0]?.hash || 'none'}`, 15000, async () => {
      const { rpc } = this.resolve(chainId);
      const verboseBlocks = await mapLimit(blocks.slice(0, 6), 3, async block => {
        try {
          return await rpc.call('getblock', [block.hash, 2]);
        } catch (_) {
          return null;
        }
      });
      const transactions = [];
      for (const block of verboseBlocks) {
        if (!block || !Array.isArray(block.tx)) continue;
        for (const transaction of block.tx) {
          if (!transaction || typeof transaction === 'string') continue;
          transactions.push(this.normalizeTransaction(transaction, {
            blockHash: block.hash,
            blockHeight: block.height,
            blockTime: block.time
          }));
          if (transactions.length >= 10) return transactions;
        }
      }
      return transactions;
    });
  }

  normalizeTransaction(transaction, context = {}) {
    return {
      txid: transaction.txid,
      blockHash: transaction.blockhash || context.blockHash || null,
      blockHeight: context.blockHeight ?? null,
      time: Number(transaction.blocktime || transaction.time || context.blockTime || 0),
      confirmations: Number(transaction.confirmations || 0),
      amount: sumOutputs(transaction),
      size: Number(transaction.size || transaction.vsize || 0),
      inputs: Array.isArray(transaction.vin) ? transaction.vin.length : 0,
      outputs: Array.isArray(transaction.vout) ? transaction.vout.length : 0,
      coinbase: Boolean(transaction.vin?.some(input => input.coinbase)),
      addresses: outputAddresses(transaction),
      outputTypes: (transaction.vout || []).map(output => output.scriptPubKey?.type || 'unknown')
    };
  }

  async overview(chainId) {
    return this.cached(`overview:${chainId}`, 12000, async () => {
      const { chain, rpc } = this.resolve(chainId);
      const [blockchain, network, mining, mempool, blocks] = await Promise.all([
        rpc.call('getblockchaininfo'),
        rpc.call('getnetworkinfo'),
        rpc.call('getmininginfo').catch(() => ({})),
        rpc.call('getmempoolinfo').catch(() => ({})),
        this.blocks(chainId, 16)
      ]);
      const transactions = await this.recentTransactions(chainId, blocks);
      const uniqueAddresses = new Set(transactions.flatMap(transaction => transaction.addresses));
      const outputTypes = {};
      for (const type of transactions.flatMap(transaction => transaction.outputTypes)) {
        outputTypes[type] = (outputTypes[type] || 0) + 1;
      }
      return {
        chain: this.chainList().find(item => item.id === chainId),
        status: {
          online: true,
          height: Number(blockchain.blocks || 0),
          headers: Number(blockchain.headers || 0),
          verificationProgress: Number(blockchain.verificationprogress || 0),
          initialBlockDownload: Boolean(blockchain.initialblockdownload),
          peers: Number(network.connections || 0),
          difficulty: Number(mining.difficulty || blocks[0]?.difficulty || 0),
          networkHashrate: Number(mining.networkhashps || 0),
          mempoolTransactions: Number(mempool.size || 0),
          mempoolBytes: Number(mempool.bytes || 0),
          recentAddresses: uniqueAddresses.size
        },
        blocks,
        transactions,
        activity: blocks.slice().reverse().map(block => ({
          time: block.time,
          transactions: block.transactionCount,
          size: block.size
        })),
        distribution: outputTypes,
        generatedAt: new Date().toISOString(),
        cacheSeconds: 12
      };
    });
  }

  async block(chainId, id) {
    const { rpc } = this.resolve(chainId);
    const hash = /^\d+$/.test(id) ? await rpc.call('getblockhash', [Number(id)]) : id;
    if (!HEX_64.test(hash)) throw Object.assign(new Error('Invalid block height or hash'), { statusCode: 400 });
    const block = await rpc.call('getblock', [hash, 1]);
    return this.normalizeBlock(block);
  }

  async transaction(chainId, txid, blockHash = null) {
    if (!HEX_64.test(txid)) throw Object.assign(new Error('Invalid transaction hash'), { statusCode: 400 });
    const { rpc } = this.resolve(chainId);
    const transaction = await rpc.call('getrawtransaction', blockHash ? [txid, true, blockHash] : [txid, true]);
    return this.normalizeTransaction(transaction, { blockHash });
  }

  async address(chainId, address) {
    if (!ADDRESS.test(address)) throw Object.assign(new Error('Invalid address format'), { statusCode: 400 });
    const { rpc } = this.resolve(chainId);
    const validation = await rpc.call('validateaddress', [address]);
    if (!validation?.isvalid) throw Object.assign(new Error('Address is not valid for this chain'), { statusCode: 404 });
    const indexer = this.indexers[chainId];
    if (indexer?.configured) {
      const indexed = await indexer.address(address);
      return {
        address,
        isValid: true,
        isMine: Boolean(validation.ismine),
        indexed: true,
        ...indexed
      };
    }
    const recent = await this.overview(chainId);
    const transactions = recent.transactions.filter(transaction => transaction.addresses.includes(address));
    return {
      address,
      isValid: true,
      isMine: Boolean(validation.ismine),
      scriptPubKey: validation.scriptPubKey || null,
      recentTransactions: transactions,
      limitedHistory: true,
      note: 'Recent-window results only. Full address history requires a separate indexed database and is intentionally not scanned from the mining node.'
    };
  }

  addressIndexStatus(chainId) {
    const { chain } = this.resolve(chainId);
    const connected = Boolean(this.indexers[chainId]?.configured);
    return {
      connected,
      source: connected ? 'external-indexer' : null,
      chainSupportsAddressIndexRpc: false,
      richListAvailable: connected,
      note: connected
        ? `External ${chain.symbol} address index configured.`
        : `${chain.symbol} Core does not expose address-index RPC methods. Configure a separate indexer to enable complete wallet history and the rich list without reindexing the mining node.`
    };
  }

  async richList(chainId, requestedLimit = 100) {
    this.resolve(chainId);
    const limit = clamp(requestedLimit, 1, 250);
    const indexer = this.indexers[chainId];
    if (!indexer?.configured) {
      return { available: false, entries: [], ...this.addressIndexStatus(chainId) };
    }
    const result = await this.cached(`rich-list:${chainId}:${limit}`, 60000, () => indexer.richList(limit));
    const entries = Array.isArray(result) ? result : result.entries;
    return {
      available: true,
      connected: true,
      source: 'external-indexer',
      entries: Array.isArray(entries) ? entries.slice(0, limit) : []
    };
  }

  async search(chainId, query) {
    const value = String(query || '').trim();
    if (!value) throw Object.assign(new Error('Search value is required'), { statusCode: 400 });
    if (/^\d+$/.test(value)) return { type: 'block', data: await this.block(chainId, value) };
    if (HEX_64.test(value)) {
      try {
        return { type: 'block', data: await this.block(chainId, value) };
      } catch (_) {
        return { type: 'transaction', data: await this.transaction(chainId, value) };
      }
    }
    return { type: 'address', data: await this.address(chainId, value) };
  }
}

module.exports = { ExplorerService, mapLimit, clamp };
