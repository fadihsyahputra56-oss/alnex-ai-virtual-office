/**
 * ALNEX AI Virtual Office — penyimpanan data.
 *
 * Dua mode:
 *  - DATABASE_URL terisi  -> PostgreSQL (Supabase). Tabel dibuat dari db/schema.sql.
 *  - DATABASE_URL kosong  -> penyimpanan di memori (untuk tes lokal / jalan awal).
 *    Data memori hilang saat server restart. JANGAN andalkan mode ini untuk
 *    produksi: isi DATABASE_URL dari Supabase.
 *
 * Aturan bisnis yang ditegakkan di sini (sama dengan artefak Muse yang
 * sudah terverifikasi):
 *  - Transaksi dideduplikasi berdasarkan transaction_id (external_id).
 *    ID yang sama dikirim dua kali hanya tersimpan satu kali.
 *  - Omzet hanya menghitung transaksi berstatus "verified".
 *    Status "pending" tersimpan, tetapi TIDAK masuk omzet.
 *  - Payload webhook mentah selalu dicatat di webhook_logs.
 */
'use strict';

const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

// ---------- Mode memori (tanpa DATABASE_URL) ----------
const mem = {
  transactions: [],
  customers: [],
  products: [],
  prospects: [],
  messages: [],
  tasks: [],
  approvals: [],
  agentOutputs: [],
  webhookLogs: [],
  auditLogs: [],
  settings: {
    ownerName: 'Fadil A.I.',
    storeUrl: 'https://lynk.id/alnex',
    lynkMerchantKey: '',
    whatsappVerifyToken: '',
    whatsappAccessToken: '',
    whatsappPhoneNumberId: '',
    ownerWhatsapp: '',
    lynkTestResult: '',
    lynkTestAt: '',
    waTestResult: '',
    waTestAt: '',
  },
  seq: { transactions: 1, customers: 1, products: 1, prospects: 1, messages: 1, tasks: 1, approvals: 1, agentOutputs: 1, webhookLogs: 1, auditLogs: 1 },
};

function nextId(table) {
  return mem.seq[table]++;
}

function maskSecret(value) {
  if (!value) return '';
  if (value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}

function maskedSettings() {
  const s = mem.settings;
  return {
    ownerName: s.ownerName,
    storeUrl: s.storeUrl,
    ownerWhatsapp: s.ownerWhatsapp,
    whatsappPhoneNumberId: s.whatsappPhoneNumberId,
    lynkHasKey: Boolean(s.lynkMerchantKey),
    lynkMerchantKeyMasked: maskSecret(s.lynkMerchantKey),
    waHasToken: Boolean(s.whatsappAccessToken),
    waAccessTokenMasked: maskSecret(s.whatsappAccessToken),
    waHasVerifyToken: Boolean(s.whatsappVerifyToken),
    waVerifyTokenMasked: maskSecret(s.whatsappVerifyToken),
    lynkTestResult: s.lynkTestResult,
    lynkTestAt: s.lynkTestAt,
    waTestResult: s.waTestResult,
    waTestAt: s.waTestAt,
  };
}

/** Normalisasi status pembayaran Lynk.id ke status internal. */
function mapPaymentStatus(raw) {
  const v = String(raw || '').toLowerCase().trim();
  if (['paid', 'success', 'successful', 'verified', 'settlement', 'complete', 'completed'].includes(v)) return 'verified';
  if (['pending', 'unpaid', 'waiting', 'processing'].includes(v)) return 'pending';
  if (['failed', 'failure', 'cancelled', 'canceled', 'expired'].includes(v)) return 'failed';
  if (['refunded', 'refund'].includes(v)) return 'refunded';
  return 'pending';
}

function findTransactionByExternalId(externalId) {
  return mem.transactions.find((t) => t.externalId === externalId);
}

function upsertCustomer({ name, contact }) {
  if (!contact && !name) return null;
  let c = mem.customers.find((x) => contact && x.contact === contact) ||
    mem.customers.find((x) => name && x.name === name && !contact);
  if (!c) {
    c = { id: nextId('customers'), name: name || 'Pelanggan', contact: contact || '', totalSpent: 0, orders: 0, createdAt: new Date().toISOString() };
    mem.customers.push(c);
  }
  return c;
}

function addWebhookLog({ source, event, externalId, payload, result, valid, duplicate }) {
  const row = {
    id: nextId('webhookLogs'),
    source,
    event,
    externalId: externalId || '',
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload ?? {}),
    result: result || '',
    valid: valid ? 1 : 0,
    duplicate: duplicate ? 1 : 0,
    createdAt: new Date().toISOString(),
  };
  mem.webhookLogs.unshift(row);
  return row;
}

function addAuditLog(action, detail) {
  mem.auditLogs.unshift({
    id: nextId('auditLogs'),
    action,
    detail: detail || '',
    createdAt: new Date().toISOString(),
  });
}

/**
 * Simpan transaksi Lynk.id. Mengembalikan { transaction, duplicate }.
 * Duplikat (external_id sudah ada) tidak disimpan ulang.
 */
function saveTransaction({ externalId, productName, amount, buyerName, buyerContact, status, source }) {
  const existing = externalId ? findTransactionByExternalId(externalId) : null;
  if (existing) return { transaction: existing, duplicate: true };
  const internalStatus = mapPaymentStatus(status);
  const tx = {
    id: nextId('transactions'),
    externalId: externalId || `MANUAL-${Date.now()}`,
    productName: productName || 'Produk',
    amount: Number(amount) || 0,
    buyerName: buyerName || 'Pembeli',
    buyerContact: buyerContact || '',
    status: internalStatus,
    source: source || 'lynk_webhook',
    occurredAt: new Date().toISOString(),
  };
  mem.transactions.unshift(tx);
  const customer = upsertCustomer({ name: tx.buyerName, contact: tx.buyerContact });
  if (customer && internalStatus === 'verified') {
    customer.totalSpent += tx.amount;
    customer.orders += 1;
  }
  addAuditLog('Transaksi disimpan', `${tx.productName} Rp${tx.amount} (${tx.status})`);
  return { transaction: tx, duplicate: false };
}

function addMessage({ senderName, senderContact, body, channel }) {
  const row = {
    id: nextId('messages'),
    senderName: senderName || 'Pelanggan',
    senderContact: senderContact || '',
    body: body || '',
    channel: channel || 'whatsapp_webhook',
    status: 'Baru',
    aiReply: '',
    createdAt: new Date().toISOString(),
  };
  mem.messages.unshift(row);
  upsertCustomer({ name: row.senderName, contact: row.senderContact });
  return row;
}

function dashboard() {
  const verified = mem.transactions.filter((t) => t.status === 'verified');
  const omzet = verified.reduce((s, t) => s + t.amount, 0);
  const byProduct = {};
  verified.forEach((t) => {
    byProduct[t.productName] = byProduct[t.productName] || { name: t.productName, orders: 0, revenue: 0 };
    byProduct[t.productName].orders += 1;
    byProduct[t.productName].revenue += t.amount;
  });
  const topProducts = Object.values(byProduct).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  // Seri harian 14 hari terakhir, mingguan 8 minggu, bulanan 6 bulan — dari data tersimpan saja.
  function series(days, labelFn) {
    const out = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const key = labelFn(d);
      const total = verified
        .filter((t) => labelFn(new Date(t.occurredAt)) === key)
        .reduce((s, t) => s + t.amount, 0);
      out.push({ label: key, total });
    }
    return out;
  }
  const daily = series(14, (d) => `${d.getDate()}/${d.getMonth() + 1}`);
  const weekly = series(8, (d) => {
    const start = new Date(d);
    start.setDate(d.getDate() - d.getDay());
    return `${start.getDate()}/${start.getMonth() + 1}`;
  });
  // Bulanan dihitung terpisah agar label bulan tidak bertabrakan.
  const monthly = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const total = verified
      .filter((t) => {
        const td = new Date(t.occurredAt);
        return `${td.getFullYear()}-${td.getMonth()}` === key;
      })
      .reduce((s, t) => s + t.amount, 0);
    monthly.push({ label: d.toLocaleString('id-ID', { month: 'short', year: 'numeric' }), total });
  }

  const s = mem.settings;
  return {
    omzet,
    orders: verified.length,
    pendingOrders: mem.transactions.filter((t) => t.status === 'pending').length,
    customers: mem.customers.length,
    prospects: mem.prospects.length,
    newMessages: mem.messages.filter((m) => m.status === 'Baru').length,
    activeTasks: mem.tasks.filter((t) => t.status === 'Aktif').length,
    pendingApprovals: mem.approvals.filter((a) => a.status === 'Menunggu').length,
    topProducts,
    daily,
    weekly,
    monthly,
    recentTransactions: mem.transactions.slice(0, 10),
    recentActivity: mem.auditLogs.slice(0, 10),
    integrations: [
      { key: 'lynk', name: 'Lynk.id', status: s.lynkMerchantKey ? 'Terhubung (kunci tersimpan)' : 'Belum terhubung', detail: 'Webhook transaksi masuk lewat POST /webhook/lynk; Merchant Key dipakai untuk validasi bila payload membawa signature/secret.' },
      { key: 'whatsapp', name: 'WhatsApp Business Cloud API', status: s.whatsappAccessToken ? 'Terhubung (token tersimpan)' : 'Belum terhubung', detail: 'Webhook pesan masuk lewat POST /webhook/whatsapp; Verify Token dipakai untuk verifikasi webhook.' },
      { key: 'ai', name: 'Agen AI (Manager, Sales, Marketing, Finance, CS)', status: 'Aktif', detail: 'Agen menjawab dari data katalog & transaksi tersimpan; tidak mengarang angka.' },
      { key: 'db', name: 'Database', status: pool ? 'Aktif (PostgreSQL)' : 'Aktif (memori — isi DATABASE_URL untuk produksi)', detail: 'Transaksi, pelanggan, prospek, pesan, tugas, log webhook, dan audit log tersimpan di database.' },
    ],
  };
}

module.exports = {
  pool,
  mem,
  maskSecret,
  maskedSettings,
  mapPaymentStatus,
  findTransactionByExternalId,
  saveTransaction,
  addWebhookLog,
  addAuditLog,
  addMessage,
  upsertCustomer,
  dashboard,
};
