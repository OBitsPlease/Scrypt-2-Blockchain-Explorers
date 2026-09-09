'use strict';

function env(name, fallback = '') {
  return process.env[name] || fallback;
}

module.exports = {
  lc2: {
    id: 'lc2',
    symbol: 'LC2',
    name: 'LitecoinII',
    role: 'Parent chain',
    logo: '/lc2-logo.png',
    website: 'https://lc2.now/',
    discord: 'https://discord.gg/Y3We4CjCe',
    color: '#2498ff',
    accent: '#69c8ff',
    background: '#02060b',
    surface: '#0b1724',
    surfaceStrong: '#10243a',
    border: 'rgba(69, 157, 231, .24)',
    blockTimeSeconds: 150,
    indexerUrl: env('LC2_INDEXER_URL'),
    rpc: {
      host: env('LC2_RPC_HOST', '127.0.0.1'),
      port: Number(env('LC2_RPC_PORT', '9222')),
      user: env('LC2_RPC_USER'),
      password: env('LC2_RPC_PASSWORD'),
      cookieFile: env('LC2_COOKIE_FILE'),
      confFile: env('LC2_CONF_FILE', process.env.APPDATA ? `${process.env.APPDATA}\\LitecoinII\\litecoinII.conf` : '')
    }
  },
  dc2: {
    id: 'dc2',
    symbol: 'DC2',
    name: 'Dogecoin2',
    role: 'Merge-mined auxiliary chain',
    logo: '/doge2-logo.png',
    website: 'https://doge2.org/',
    discord: 'https://discord.gg/yDzST8tTk',
    color: '#ff8a1f',
    accent: '#ffc15a',
    background: '#050403',
    surface: '#1b1008',
    surfaceStrong: '#2a170a',
    border: 'rgba(255, 138, 31, .24)',
    blockTimeSeconds: 60,
    indexerUrl: env('DC2_INDEXER_URL'),
    rpc: {
      host: env('DC2_RPC_HOST', '127.0.0.1'),
      port: Number(env('DC2_RPC_PORT', '22655')),
      user: env('DC2_RPC_USER'),
      password: env('DC2_RPC_PASSWORD'),
      cookieFile: env('DC2_COOKIE_FILE', process.env.APPDATA ? `${process.env.APPDATA}\\Dogecoin2\\.cookie` : ''),
      confFile: env('DC2_CONF_FILE', process.env.APPDATA ? `${process.env.APPDATA}\\Dogecoin2\\dogecoin2.conf` : '')
    }
  }
};
