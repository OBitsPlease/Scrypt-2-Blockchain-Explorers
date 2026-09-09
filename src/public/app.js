'use strict';

const state = {
  chainId: localStorage.getItem('explorerChain') || 'lc2',
  view: 'dashboard',
  chains: [],
  overview: null,
  chart: null,
  timer: null
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function compact(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: digits }).format(number);
}

function formatHashrate(value) {
  const units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s'];
  let number = Number(value || 0);
  let unit = 0;
  while (number >= 1000 && unit < units.length - 1) {
    number /= 1000;
    unit++;
  }
  return `${number.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${units[unit]}`;
}

function formatBytes(value) {
  const number = Number(value || 0);
  if (number < 1024) return `${number} B`;
  if (number < 1048576) return `${(number / 1024).toFixed(1)} KB`;
  return `${(number / 1048576).toFixed(2)} MB`;
}

function shortHash(value, size = 12) {
  if (!value) return '--';
  return `${value.slice(0, size)}…${value.slice(-5)}`;
}

function relativeTime(seconds) {
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000 - Number(seconds || 0)));
  if (elapsed < 60) return `${elapsed}s ago`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ago`;
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)}h ago`;
  return `${Math.floor(elapsed / 86400)}d ago`;
}

async function request(path) {
  const response = await fetch(path, { headers: { Accept: 'application/json' } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function currentChain() {
  return state.chains.find(chain => chain.id === state.chainId) || state.chains[0];
}

function setError(message = '') {
  const banner = $('#errorBanner');
  banner.hidden = !message;
  banner.textContent = message;
  $('#liveDot').classList.toggle('offline', Boolean(message));
}

function renderChainTabs() {
  $('#chainTabs').innerHTML = state.chains.map(chain =>
    `<button class="chain-tab ${chain.id === state.chainId ? 'active' : ''}" data-chain="${escapeHtml(chain.id)}" title="${escapeHtml(chain.name)}"><img src="${escapeHtml(chain.logo)}" alt="">${escapeHtml(chain.symbol)}</button>`
  ).join('');
  $$('.chain-tab').forEach(button => button.addEventListener('click', () => selectChain(button.dataset.chain)));
}

function renderOverview(data) {
  const { chain, status, blocks, transactions } = data;
  document.documentElement.dataset.chain = chain.id;
  document.documentElement.style.setProperty('--blue', chain.color);
  document.documentElement.style.setProperty('--purple', chain.accent);
  document.documentElement.style.setProperty('--cyan', chain.accent);
  document.documentElement.style.setProperty('--bg', chain.background);
  document.documentElement.style.setProperty('--surface', chain.surface);
  document.documentElement.style.setProperty('--surface-strong', chain.surfaceStrong);
  document.documentElement.style.setProperty('--border', chain.border);
  document.documentElement.style.setProperty('--theme-glow', chain.id === 'dc2' ? 'rgba(255, 119, 16, .16)' : 'rgba(36, 152, 255, .16)');
  document.documentElement.style.setProperty('--theme-glow-soft', chain.id === 'dc2' ? 'rgba(157, 65, 5, .09)' : 'rgba(18, 76, 142, .09)');
  $('#brandLogo').src = chain.logo;
  $('#brandLogo').alt = `${chain.symbol} logo`;
  $('#brandSymbol').textContent = chain.symbol;
  $('#chainRole').textContent = `${chain.name} · ${chain.role}`;
  $('#websiteLink').href = chain.website;
  $('#websiteLink').setAttribute('aria-label', `Open the official ${chain.name} website`);
  $('#discordLink').href = chain.discord;
  $('#discordLink').setAttribute('aria-label', `Join the ${chain.name} Discord`);
  $('#networkState').textContent = status.initialBlockDownload ? 'Syncing' : 'Online';
  $('#heightValue').textContent = `Height: ${status.height.toLocaleString()}`;
  $('#hashrateValue').textContent = formatHashrate(status.networkHashrate);
  $('#mempoolValue').textContent = `${status.mempoolTransactions.toLocaleString()} Tx`;
  $('#difficultyValue').textContent = compact(status.difficulty, 3);
  $('#addressValue').textContent = status.recentAddresses.toLocaleString();
  $('#blockCount').textContent = `${blocks.length} latest`;
  $('#updatedText').textContent = `Updated ${new Date(data.generatedAt).toLocaleTimeString()} · cached ${data.cacheSeconds}s`;

  $('#blockStream').innerHTML = blocks.map(block => `
    <div class="block-row" data-block="${block.height}">
      <span class="block-icon">◇</span>
      <span class="block-main">
        <strong>Block ${block.height.toLocaleString()}</strong>
        <small>${block.transactionCount.toLocaleString()} Tx · ${relativeTime(block.time)}</small>
      </span>
      <span class="block-size">${formatBytes(block.size)}<i></i></span>
    </div>
  `).join('') || '<p class="muted">No blocks returned.</p>';

  $('#latestTransactions').innerHTML = transactions.slice(0, 7).map(transaction => `
    <div class="transaction-row" data-tx="${transaction.txid}" data-block-hash="${transaction.blockHash || ''}">
      <span class="hash">${shortHash(transaction.txid, 10)}</span>
      <span>${transaction.outputs ?? '--'}</span>
      <span>${transaction.amount == null ? '--' : compact(transaction.amount, 3)}</span>
    </div>
  `).join('') || '<p class="muted">No recent transactions.</p>';

  $('#networkFacts').innerHTML = [
    ['01', 'Connected peers', 'Network connections', status.peers.toLocaleString()],
    ['02', 'Chain sync', `${status.height.toLocaleString()} / ${status.headers.toLocaleString()} headers`, `${(status.verificationProgress * 100).toFixed(2)}%`],
    ['03', 'Mempool size', `${status.mempoolTransactions.toLocaleString()} transactions`, formatBytes(status.mempoolBytes)],
    ['04', 'Block target', chain.role, `${chain.blockTimeSeconds}s`],
    ['05', 'Address index', chain.addressIndexConnected ? 'External indexer connected' : 'External indexer not connected', chain.addressIndexConnected ? 'Online' : 'Limited']
  ].map(item => `<div class="fact-row"><b>${item[0]}</b><div><strong>${escapeHtml(item[1])}</strong><small>${escapeHtml(item[2])}</small></div><em>${escapeHtml(item[3])}</em></div>`).join('');

  const nonCoinbase = transactions.filter(transaction => !transaction.coinbase).length;
  const standard = transactions.flatMap(transaction => transaction.outputTypes).filter(type => ['pubkeyhash', 'scripthash', 'witness_v0_keyhash', 'witness_v0_scripthash'].includes(type)).length;
  const outputs = transactions.flatMap(transaction => transaction.outputTypes).length;
  const activeBlocks = blocks.filter(block => block.transactionCount > 1).length;
  $('#transferPercent').textContent = `${transactions.length ? Math.round(nonCoinbase / transactions.length * 100) : 0}%`;
  $('#scriptPercent').textContent = `${outputs ? Math.round(standard / outputs * 100) : 0}%`;
  $('#blockPercent').textContent = `${blocks.length ? Math.round(activeBlocks / blocks.length * 100) : 0}%`;

  renderChart(data.activity);
  bindDataRows();
  renderDetailView();
}

function renderChart(activity) {
  const canvas = $('#activityChart');
  if (!window.Chart || !canvas) return;
  if (state.chart) state.chart.destroy();
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, 280);
  const chartColor = currentChain()?.color || '#58bcff';
  gradient.addColorStop(0, `${chartColor}99`);
  gradient.addColorStop(1, `${chartColor}00`);
  state.chart = new Chart(context, {
    type: 'line',
    data: {
      labels: activity.map(point => new Date(point.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
      datasets: [{
        label: 'Transactions',
        data: activity.map(point => point.transactions),
            borderColor: chartColor,
        backgroundColor: gradient,
        fill: true,
        tension: .42,
        pointRadius: 2,
        pointHoverRadius: 6,
        borderWidth: 2
      }]
    },
    options: {
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#71839a', maxTicksLimit: 7 } },
        y: { beginAtZero: true, grid: { color: 'rgba(137,174,218,.11)' }, ticks: { color: '#71839a', precision: 0 } }
      }
    }
  });
}

function bindDataRows() {
  $$('[data-block]').forEach(row => row.addEventListener('click', () => showBlock(row.dataset.block)));
  $$('[data-tx]').forEach(row => row.addEventListener('click', () => showTransaction(row.dataset.tx, row.dataset.blockHash)));
}

function renderDetailView() {
  const dashboard = $('#dashboardView');
  const detail = $('#detailView');
  const cards = $('#overviewCards');
  dashboard.hidden = state.view !== 'dashboard';
  detail.hidden = state.view === 'dashboard';
  cards.hidden = !['dashboard', 'analytics'].includes(state.view);
  if (state.view === 'dashboard' || !state.overview) return;

  const data = state.overview;
  const chain = data.chain;
  if (state.view === 'blocks') {
    $('#pageTitle').textContent = 'Blocks';
    $('#detailTitle').textContent = `Latest ${chain.symbol} Blocks`;
    $('#detailSubtitle').textContent = 'Select a block to inspect its header and transaction IDs';
    $('#detailContent').innerHTML = table(
      ['Height', 'Hash', 'Transactions', 'Size', 'Mined'],
      data.blocks.map(block => [
        block.height.toLocaleString(),
        `<span class="hash">${escapeHtml(block.hash)}</span>`,
        block.transactionCount.toLocaleString(),
        formatBytes(block.size),
        relativeTime(block.time)
      ]),
      data.blocks.map(block => `data-block="${block.height}"`)
    );
  } else if (state.view === 'transactions') {
    $('#pageTitle').textContent = 'Transactions';
    $('#detailTitle').textContent = `Recent ${chain.symbol} Transactions`;
    $('#detailSubtitle').textContent = 'Recent bounded sample; use search for a transaction ID';
    $('#detailContent').innerHTML = table(
      ['Transaction hash', 'Block', 'Inputs', 'Outputs', `Amount (${chain.symbol})`, 'Time'],
      data.transactions.map(transaction => [
        `<span class="hash">${escapeHtml(transaction.txid)}</span>`,
        transaction.blockHeight?.toLocaleString() || '--',
        transaction.inputs ?? '--',
        transaction.outputs ?? '--',
        transaction.amount == null ? '--' : transaction.amount.toLocaleString(undefined, { maximumFractionDigits: 8 }),
        relativeTime(transaction.time)
      ]),
      data.transactions.map(transaction => `data-tx="${transaction.txid}" data-block-hash="${transaction.blockHash || ''}"`)
    );
  } else if (state.view === 'wallets') {
    $('#pageTitle').textContent = 'Wallets';
    $('#detailTitle').textContent = `${chain.symbol} Address Lookup`;
    $('#detailSubtitle').textContent = chain.addressIndexConnected ? 'Full external address index connected' : 'Recent-window lookup; external address index not connected';
    const addresses = [...new Set(data.transactions.flatMap(transaction => transaction.addresses))].slice(0, 18);
    $('#detailContent').innerHTML = `
      <div class="info-grid">
        <div class="info-box"><small>Recent addresses</small><strong>${data.status.recentAddresses.toLocaleString()}</strong></div>
        <div class="info-box"><small>Sampled transactions</small><strong>${data.transactions.length.toLocaleString()}</strong></div>
        <div class="info-box"><small>Address index</small><strong>${chain.addressIndexConnected ? 'Connected' : 'Not connected'}</strong></div>
      </div>
      <div class="index-state"><i class="index-indicator ${chain.addressIndexConnected ? 'connected' : ''}"></i><div><strong>${chain.addressIndexConnected ? 'External address index online' : 'External address index required'}</strong><span>${chain.addressIndexConnected ? 'Address searches use the connected indexed service.' : `The installed ${escapeHtml(chain.symbol)} daemon has no address-index RPC methods. Search still validates addresses and checks recent blocks without scanning or reindexing the mining node.`}</span></div></div>
      <p class="wallet-note">Search for a ${escapeHtml(chain.symbol)} address above. ${chain.addressIndexConnected ? 'Complete indexed history and balances are available.' : 'Complete historical balances require a separate indexer configured with the applicable INDEXER_URL setting.'}</p>
      <h3>Recently observed addresses</h3>
      ${addresses.length ? table(['Address'], addresses.map(address => [`<span class="hash">${escapeHtml(address)}</span>`]), addresses.map(address => `data-address="${address}"`)) : '<p class="muted">No decoded addresses in the current sample.</p>'}
    `;
  } else if (state.view === 'rich-list') {
    $('#pageTitle').textContent = 'Rich List';
    $('#detailTitle').textContent = `${chain.symbol} Rich List`;
    $('#detailSubtitle').textContent = chain.addressIndexConnected ? 'Top indexed balances' : 'Awaiting a separate address index';
    $('#detailContent').innerHTML = '<div class="empty-state"><h3>Checking address index...</h3><p>The rich list requires complete indexed UTXO data.</p></div>';
    loadRichList();
  } else {
    $('#pageTitle').textContent = 'Analytics';
    $('#detailTitle').textContent = `${chain.symbol} Chain Analytics`;
    $('#detailSubtitle').textContent = 'Live node metrics and recent block activity';
    $('#detailContent').innerHTML = `
      <div class="info-grid">
        <div class="info-box"><small>Network hashrate</small><strong>${formatHashrate(data.status.networkHashrate)}</strong></div>
        <div class="info-box"><small>Difficulty</small><strong>${compact(data.status.difficulty, 4)}</strong></div>
        <div class="info-box"><small>Connected peers</small><strong>${data.status.peers.toLocaleString()}</strong></div>
        <div class="info-box"><small>Mempool transactions</small><strong>${data.status.mempoolTransactions.toLocaleString()}</strong></div>
        <div class="info-box"><small>Average sampled block size</small><strong>${formatBytes(data.blocks.reduce((sum, block) => sum + block.size, 0) / Math.max(1, data.blocks.length))}</strong></div>
        <div class="info-box"><small>Average transactions / block</small><strong>${(data.blocks.reduce((sum, block) => sum + block.transactionCount, 0) / Math.max(1, data.blocks.length)).toFixed(2)}</strong></div>
      </div>
      <p class="wallet-note">Analytics use a bounded recent block window and cached RPC responses so the explorer does not materially compete with block-template work on the mining node.</p>
    `;
  }
  bindDataRows();
  $$('[data-address]').forEach(row => row.addEventListener('click', () => runSearch(row.dataset.address)));
}

function table(headings, rows, rowAttributes = []) {
  return `<table class="data-table"><thead><tr>${headings.map(heading => `<th>${escapeHtml(heading)}</th>`).join('')}</tr></thead><tbody>${
    rows.map((row, index) => `<tr ${rowAttributes[index] || ''}>${row.map(value => `<td>${value}</td>`).join('')}</tr>`).join('')
  }</tbody></table>`;
}

function setView(view) {
  state.view = view;
  if (view === 'dashboard') $('#pageTitle').textContent = 'Network Overview';
  $$('.nav-link').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  renderDetailView();
}

async function loadRichList() {
  const chainAtRequest = state.chainId;
  try {
    const result = await request(`/api/explorer/${chainAtRequest}/rich-list?limit=100`);
    if (state.chainId !== chainAtRequest || state.view !== 'rich-list') return;
    if (!result.available) {
      $('#detailContent').innerHTML = `<div class="empty-state"><h3>Rich list not available yet</h3><p>${escapeHtml(result.note)} This protects the active mining node from a disruptive full-chain reindex.</p></div>`;
      return;
    }
    $('#detailContent').innerHTML = table(
      ['Rank', 'Address', `Balance (${currentChain().symbol})`, 'Supply share'],
      result.entries.map((entry, index) => [
        `#${index + 1}`,
        `<span class="hash">${escapeHtml(entry.address)}</span>`,
        Number(entry.balance || 0).toLocaleString(undefined, { maximumFractionDigits: 8 }),
        entry.percentage == null ? '--' : `${Number(entry.percentage).toFixed(4)}%`
      ]),
      result.entries.map(entry => `data-address="${escapeHtml(entry.address)}"`)
    );
    $$('[data-address]').forEach(row => row.addEventListener('click', () => runSearch(row.dataset.address)));
  } catch (error) {
    if (state.chainId === chainAtRequest && state.view === 'rich-list') {
      $('#detailContent').innerHTML = `<div class="empty-state"><h3>Address index unavailable</h3><p>${escapeHtml(error.message)}</p></div>`;
    }
  }
}

async function selectChain(chainId) {
  if (state.chainId === chainId) return;
  state.chainId = chainId;
  localStorage.setItem('explorerChain', chainId);
  renderChainTabs();
  await loadOverview();
}

function resultGrid(data) {
  const ignored = new Set(['txids', 'recentTransactions', 'addresses', 'outputTypes']);
  const rows = Object.entries(data).filter(([key]) => !ignored.has(key)).map(([key, value]) => {
    const shown = typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
    return `<dt>${escapeHtml(key.replace(/([A-Z])/g, ' $1'))}</dt><dd>${escapeHtml(shown)}</dd>`;
  }).join('');
  const txids = Array.isArray(data.txids) ? `<h3>Transactions (${data.txids.length})</h3><div class="hash">${data.txids.map(escapeHtml).join('<br>')}</div>` : '';
  const transactions = Array.isArray(data.recentTransactions) ? `<h3>Recent matches (${data.recentTransactions.length})</h3>${data.recentTransactions.map(transaction => `<p class="hash">${escapeHtml(transaction.txid)}</p>`).join('')}` : '';
  return `<dl class="result-grid">${rows}</dl>${txids}${transactions}`;
}

function openResult(title, data) {
  $('#resultTitle').textContent = title;
  $('#resultBody').innerHTML = resultGrid(data);
  $('#resultDialog').showModal();
}

async function showBlock(id) {
  try {
    const block = await request(`/api/explorer/${state.chainId}/block/${encodeURIComponent(id)}`);
    openResult(`Block ${block.height.toLocaleString()}`, block);
  } catch (error) {
    setError(error.message);
  }
}

async function showTransaction(txid, blockHash = '') {
  try {
    const suffix = blockHash ? `?blockHash=${encodeURIComponent(blockHash)}` : '';
    const transaction = await request(`/api/explorer/${state.chainId}/transaction/${encodeURIComponent(txid)}${suffix}`);
    openResult('Transaction', transaction);
  } catch (error) {
    setError(error.message);
  }
}

async function runSearch(value) {
  const query = String(value || '').trim();
  if (!query) return;
  try {
    setError();
    const result = await request(`/api/explorer/${state.chainId}/search?q=${encodeURIComponent(query)}`);
    openResult(result.type[0].toUpperCase() + result.type.slice(1), result.data);
  } catch (error) {
    setError(error.message);
  }
}

async function loadOverview() {
  clearTimeout(state.timer);
  $('#updatedText').textContent = `Loading ${currentChain()?.symbol || ''}...`;
  try {
    const data = await request(`/api/explorer/${state.chainId}/overview`);
    state.overview = data;
    setError();
    renderOverview(data);
  } catch (error) {
    setError(`Unable to load ${currentChain()?.symbol || 'chain'}: ${error.message}. Check the explorer RPC settings and confirm the daemon is running.`);
    $('#updatedText').textContent = 'Connection unavailable';
  } finally {
    state.timer = setTimeout(loadOverview, 15000);
  }
}

async function initialize() {
  try {
    state.chains = await request('/api/chains');
    if (!state.chains.some(chain => chain.id === state.chainId)) state.chainId = state.chains[0]?.id;
    renderChainTabs();
    await loadOverview();
  } catch (error) {
    setError(error.message);
  }
}

$('#searchForm').addEventListener('submit', event => {
  event.preventDefault();
  runSearch($('#searchInput').value);
});
$('#closeDialog').addEventListener('click', () => $('#resultDialog').close());
$$('.nav-link').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
$$('[data-jump]').forEach(button => button.addEventListener('click', () => setView(button.dataset.jump)));
initialize();
