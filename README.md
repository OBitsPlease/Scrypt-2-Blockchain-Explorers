# Scrypt 2.0 Blockchain Explorers

A read-only web explorer for LC2, DC2, and future Scrypt 2.0 merge-mined chains.

The interface includes:

- Configurable LC2/DC2 chain tabs
- Live blocks, decoded transactions, mempool, peers, hashrate, and difficulty
- Block-height, block-hash, transaction-hash, and address search
- Chain activity charts and analytics
- Optional full address history, balances, UTXOs, and rich lists through external indexers
- Per-chain branding, community links, and responsive desktop/mobile layouts

## Safety design

- Uses an explicit allowlist of read-only daemon RPC methods.
- Never submits blocks, sends funds, unlocks wallets, or runs `scantxoutset`.
- Limits daemon RPC concurrency to three requests per chain.
- Caches overview and recent-chain requests.
- Limits block windows and response sizes.
- Binds to `127.0.0.1` by default.
- Keeps RPC credentials on the server; they are never sent to browser JavaScript.
- Supports separate address indexers so public traffic and full-chain indexing do not burden a mining node.

## Local development

Requirements:

- Node.js 18 or newer
- Running LC2 and/or DC2 nodes

Start the explorer:

```bash
cp .env.example .env
npm test
npm start
```

Open the URL printed in the terminal. The preferred port is `8090`; if it is occupied, local development automatically selects the next available port.

On the original Windows mining PC, the explorer can read authentication from the existing daemon configuration files. For Linux and VPS deployments, use explicit environment settings as described below.

## Adding another merge-mined chain

Add an entry to `src/chains.js`. The chain selector and API validation are generated from this configuration. Each chain should have:

- A unique ID and symbol
- Branding colors and logo
- A private RPC connection
- Its expected block interval
- Optional website and Discord links
- An optional external indexer URL

# VPS deployment guide

The recommended production design separates public web traffic, daemon RPC, and address indexing:

```text
Internet
   |
HTTPS reverse proxy (Caddy or Nginx)
   |
Explorer on 127.0.0.1:8092
   |-------------------------------|
   |                               |
LC2 indexer                    DC2 indexer
127.0.0.1:8093                127.0.0.1:8094
   |                               |
LC2 node RPC                  DC2 node RPC
127.0.0.1:9222                127.0.0.1:22655
```

If the nodes already run on the VPS, do not resynchronize them unnecessarily. Confirm their configuration and add the explorer/indexer services around them.

## Step 1: Configure private node RPC access

The explorer needs daemon RPC for blocks, transactions, network status, mining data, and mempool data.

Keep RPC private. When the explorer and nodes are on the same VPS:

```ini
server=1
rpcbind=127.0.0.1
rpcallowip=127.0.0.1
rpcuser=explorer_lc2
rpcpassword=REPLACE_WITH_A_LONG_RANDOM_PASSWORD
```

Use separate credentials for DC2.

If nodes run on another private server:

- Use a private LAN or WireGuard address.
- Bind RPC only to that private interface.
- Allow only the explorer/indexer host through the firewall.
- Never expose an RPC port to the public internet.

Prefer `rpcauth` instead of plaintext `rpcpassword` when supported by the daemon.

Test RPC locally before configuring the explorer:

```bash
curl --user explorer_lc2:YOUR_PASSWORD \
  --data-binary '{"jsonrpc":"1.0","id":"check","method":"getblockchaininfo","params":[]}' \
  -H 'content-type:text/plain;' \
  http://127.0.0.1:9222/
```

Repeat with the DC2 port and credentials.

## Step 2: Confirm transaction indexing

Recent transactions can be decoded from their containing blocks without a transaction index. Direct transaction-hash search normally requires:

```ini
txindex=1
```

Check whether it is already enabled before changing a running node.

If `txindex` was not enabled when the node synchronized, the daemon may require a full reindex after enabling it. Reindexing is disk- and CPU-intensive. Perform it on dedicated VPS explorer nodes, not on the active solo-mining node.

Wait until both nodes report fully synchronized block/header heights before publishing the explorer.

## Step 3: Deploy address indexers

The tested LC2 and DC2 daemon builds do not expose these common address-index RPC methods:

- `getaddressbalance`
- `getaddressutxos`
- `getaddresstxids`
- `getaddressdeltas`

Because of that, `addressindex=1` alone is not sufficient unless a different daemon build actually implements the related RPC methods.

For complete address information, deploy one external indexer per chain. Each indexer should:

1. Read blocks from its private daemon RPC.
2. Decode transaction inputs and outputs.
3. Track spendable outputs by address.
4. Store address transaction history.
5. Calculate balances, received totals, sent totals, and UTXO counts.
6. Handle chain reorganizations by rolling back orphaned blocks.
7. Resume from its last committed height after restart.
8. Build rich-list results from indexed unspent balances.

The indexer database should be on persistent storage. PostgreSQL is a reasonable production choice, but the explorer only requires the HTTP contract below.

### Required address endpoint

```http
GET /address/:address
```

Suggested response:

```json
{
  "address": "example-address",
  "balance": 1250.5,
  "received": 1800.5,
  "sent": 550,
  "transactionCount": 42,
  "utxoCount": 3,
  "transactions": [
    {
      "txid": "transaction-hash",
      "height": 90000,
      "time": 1788990000,
      "amount": 50,
      "confirmations": 100
    }
  ]
}
```

### Required rich-list endpoint

```http
GET /rich-list?limit=100
```

It may return an array or an object containing `entries`:

```json
{
  "entries": [
    {
      "address": "example-address",
      "balance": 500000,
      "percentage": 4.125
    }
  ]
}
```

Without an external indexer, the explorer safely validates addresses and searches its bounded recent block window. Wallets will show that the index is not connected, and Rich List will remain unavailable rather than displaying fabricated data.

## Step 4: Configure the explorer environment

Clone the repository and create the environment file:

```bash
git clone https://github.com/OBitsPlease/Scrypt-2-Blockchain-Explorers.git
cd Scrypt-2-Blockchain-Explorers
cp .env.example .env
```

Recommended VPS `.env`:

```dotenv
EXPLORER_HOST=127.0.0.1
EXPLORER_PORT=8092

LC2_RPC_HOST=127.0.0.1
LC2_RPC_PORT=9222
LC2_RPC_USER=explorer_lc2
LC2_RPC_PASSWORD=REPLACE_WITH_A_LONG_RANDOM_PASSWORD
LC2_CONF_FILE=
LC2_INDEXER_URL=http://127.0.0.1:8093

DC2_RPC_HOST=127.0.0.1
DC2_RPC_PORT=22655
DC2_RPC_USER=explorer_dc2
DC2_RPC_PASSWORD=REPLACE_WITH_A_DIFFERENT_LONG_RANDOM_PASSWORD
DC2_COOKIE_FILE=
DC2_CONF_FILE=
DC2_INDEXER_URL=http://127.0.0.1:8094
```

Notes:

- Keep `.env` out of Git. It is already ignored.
- Use explicit RPC credentials on Linux instead of the Windows configuration-file defaults.
- Leave an indexer URL blank until that indexer is ready.
- Use a fixed production explorer port so the reverse proxy always has a stable upstream.

Validate the application:

```bash
npm test
npm start
```

Then check:

```bash
curl http://127.0.0.1:8092/health
curl http://127.0.0.1:8092/api/chains
curl http://127.0.0.1:8092/api/explorer/lc2/overview
curl http://127.0.0.1:8092/api/explorer/dc2/overview
```

## Step 5: Run the explorer as a service

Create a dedicated non-root account and place the repository in a stable directory such as `/opt/scrypt-2-explorer`.

Example systemd unit:

```ini
[Unit]
Description=Scrypt 2.0 Blockchain Explorer
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=scrypt-explorer
Group=scrypt-explorer
WorkingDirectory=/opt/scrypt-2-explorer
ExecStart=/usr/bin/node /opt/scrypt-2-explorer/src/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/scrypt-2-explorer

[Install]
WantedBy=multi-user.target
```

Install and start it:

```bash
sudo cp scrypt-2-explorer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now scrypt-2-explorer
sudo systemctl status scrypt-2-explorer
```

View logs with:

```bash
journalctl -u scrypt-2-explorer -f
```

Run each indexer as its own non-root service with its own database credentials and restart policy.

## Step 6: Publish through HTTPS

Keep the Node process bound to localhost and expose only the reverse proxy.

Example Nginx configuration:

```nginx
server {
    listen 80;
    server_name explorer.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name explorer.example.com;

    ssl_certificate /etc/letsencrypt/live/explorer.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/explorer.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8092;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 10s;
        proxy_read_timeout 30s;
        limit_req zone=explorer burst=30 nodelay;
    }
}
```

Define the Nginx rate-limit zone in the `http` block:

```nginx
limit_req_zone $binary_remote_addr zone=explorer:10m rate=10r/s;
```

Use Certbot, Caddy, or another trusted ACME client for TLS certificates.

## Step 7: Firewall, monitor, and verify

Publicly allow only:

- TCP 80 for HTTP-to-HTTPS redirects
- TCP 443 for the explorer website
- SSH from trusted administrative addresses

Do not publicly allow:

- LC2 RPC port `9222`
- DC2 RPC port `22655`
- Explorer port `8092`
- Indexer ports `8093` and `8094`
- Database ports

Final checks:

1. Confirm LC2 and DC2 report current block/header heights.
2. Confirm direct transaction-hash searches work when `txindex=1`.
3. Confirm `/api/explorer/lc2/address-index` and the DC2 equivalent report the expected connection state.
4. Search a known address and compare its indexed balance to an independent source.
5. Compare several rich-list balances against direct indexed UTXO calculations.
6. Test an address with no activity and an invalid address.
7. Confirm reorg handling on a staging chain or from recorded fixtures.
8. Verify daemon RPC and indexer ports are unreachable from the public internet.
9. Monitor CPU, memory, disk I/O, database size, RPC latency, and indexer lag.
10. Back up the indexer databases and configuration secrets.

The explorer can be rebuilt from the chain, but a database backup substantially reduces recovery time.

## Updating a deployment

```bash
cd /opt/scrypt-2-explorer
git pull --ff-only
npm test
sudo systemctl restart scrypt-2-explorer
sudo systemctl status scrypt-2-explorer
```

Review configuration changes before restarting production.

## License

MIT
