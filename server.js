/**
 * ALNEX AI Virtual Office — server Node.js/Express.
 * Owner: Fadil A.I.  Toko: https://lynk.id/alnex
 *
 * Jalankan:  npm install && npm start   (port dari env PORT, default 3000)
 * Kesehatan: GET /health
 * Webhook:   POST /webhook/lynk, GET+POST /webhook/whatsapp
 * API:       GET /api/dashboard, /api/transactions, /api/customers,
 *            /api/products, /api/prospects, /api/messages, /api/tasks,
 *            /api/approvals, /api/webhook-logs, /api/audit-logs,
 *            /api/settings, POST /api/settings, POST /api/agents/ask
 *
 * KEAMANAN:
 *  - Secret (Merchant Key, token WhatsApp) hanya dibaca dari environment
 *    variables atau dari penyimpanan server; API hanya mengembalikan
 *    versi termasking (4 karakter terakhir).
 *  - Jangan pernah menulis secret asli ke file, ke log, atau ke frontend.
 *  - Login owner sederhana: OWNER_PIN di env. Bila OWNER_PIN terisi,
 *    endpoint /api/* (kecuali /health dan webhook) meminta header
 *    `x-owner-pin` yang cocok. Bila OWNER_PIN kosong, API terbuka —
 *    isi PIN sebelum deploy ke publik.
 */
'use strict';

const express = require('express');
const path = require('path');
const store = require('./src/store');
const webhooks = require('./src/webhooks');
const agents = require('./src/agents');

const app = express();
const PORT = process.env.PORT || 3000;

// Simpan body mentah untuk verifikasi HMAC webhook.
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Kesehatan ----------
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'alnex-ai-virtual-office', time: new Date().toISOString(), db: store.pool ? 'postgres' : 'memory' });
});

// ---------- Webhook (publik, tanpa login owner) ----------
app.post('/webhook/lynk', webhooks.handleLynkWebhook);
app.get('/webhook/whatsapp', webhooks.verifyWhatsapp);
app.post('/webhook/whatsapp', webhooks.handleWhatsappWebhook);

// ---------- Login owner (opsional, aktif bila OWNER_PIN terisi) ----------
function requireOwnerPin(req, res, next) {
  const pin = process.env.OWNER_PIN || '';
  if (!pin) return next();
  if (req.get('x-owner-pin') === pin) return next();
  return res.status(401).json({ ok: false, error: 'unauthorized: OWNER_PIN tidak cocok' });
}
app.use('/api', requireOwnerPin);

// ---------- API dashboard & data (hanya dari data tersimpan) ----------
app.get('/api/dashboard', (_req, res) => res.json({ ok: true, data: store.dashboard() }));
app.get('/api/transactions', (_req, res) => res.json({ ok: true, data: store.mem.transactions }));
app.get('/api/customers', (_req, res) => res.json({ ok: true, data: store.mem.customers }));
app.get('/api/products', (_req, res) => res.json({ ok: true, data: store.mem.products }));
app.get('/api/prospects', (_req, res) => res.json({ ok: true, data: store.mem.prospects }));
app.get('/api/messages', (_req, res) => res.json({ ok: true, data: store.mem.messages }));
app.get('/api/tasks', (_req, res) => res.json({ ok: true, data: store.mem.tasks }));
app.get('/api/approvals', (_req, res) => res.json({ ok: true, data: store.mem.approvals }));
app.get('/api/agent-outputs', (_req, res) => res.json({ ok: true, data: store.mem.agentOutputs }));
app.get('/api/webhook-logs', (_req, res) => res.json({ ok: true, data: store.mem.webhookLogs }));
app.get('/api/audit-logs', (_req, res) => res.json({ ok: true, data: store.mem.auditLogs }));
app.get('/api/finance', (_req, res) => {
  const d = store.dashboard();
  res.json({ ok: true, data: { omzet: d.omzet, orders: d.orders, pendingOrders: d.pendingOrders, topProducts: d.topProducts, daily: d.daily, weekly: d.weekly, monthly: d.monthly } });
});

// ---------- Pengaturan integrasi (secret termasking) ----------
app.get('/api/settings', (_req, res) => res.json({ ok: true, data: store.maskedSettings() }));

app.post('/api/settings', (req, res) => {
  const b = req.body || {};
  const s = store.mem.settings;
  // Field secret yang kosong = pertahankan nilai lama (jangan menimpa dengan kosong).
  if (b.ownerName !== undefined) s.ownerName = b.ownerName;
  if (b.storeUrl !== undefined) s.storeUrl = b.storeUrl;
  if (b.ownerWhatsapp !== undefined) s.ownerWhatsapp = b.ownerWhatsapp;
  if (b.whatsappPhoneNumberId !== undefined) s.whatsappPhoneNumberId = b.whatsappPhoneNumberId;
  if (b.lynkMerchantKey) s.lynkMerchantKey = b.lynkMerchantKey;
  if (b.whatsappAccessToken) s.whatsappAccessToken = b.whatsappAccessToken;
  if (b.whatsappVerifyToken) s.whatsappVerifyToken = b.whatsappVerifyToken;
  store.addAuditLog('Pengaturan diubah', 'Pengaturan integrasi diperbarui oleh owner (secret tidak ditampilkan).');
  res.json({ ok: true, data: store.maskedSettings() });
});

// ---------- Produk / pelanggan / prospek / pesan (CRUD sederhana) ----------
app.post('/api/products', (req, res) => {
  const b = req.body || {};
  const row = { id: store.mem.seq.products++, name: b.name || 'Produk', price: Number(b.price) || 0, url: b.url || '', createdAt: new Date().toISOString() };
  store.mem.products.unshift(row);
  res.json({ ok: true, data: row });
});
app.delete('/api/products/:id', (req, res) => {
  store.mem.products = store.mem.products.filter((p) => String(p.id) !== req.params.id);
  res.json({ ok: true });
});
app.post('/api/customers', (req, res) => {
  const b = req.body || {};
  const row = store.upsertCustomer({ name: b.name, contact: b.contact });
  res.json({ ok: true, data: row });
});
app.post('/api/prospects', (req, res) => {
  const b = req.body || {};
  const row = { id: store.mem.seq.prospects++, name: b.name || 'Prospek', contact: b.contact || '', status: b.status || 'Baru', createdAt: new Date().toISOString() };
  store.mem.prospects.unshift(row);
  res.json({ ok: true, data: row });
});
app.post('/api/messages', (req, res) => {
  const b = req.body || {};
  const row = store.addMessage({ senderName: b.senderName, senderContact: b.senderContact, body: b.body, channel: 'manual' });
  res.json({ ok: true, data: row });
});

// ---------- Transaksi manual & status ----------
app.post('/api/transactions', (req, res) => {
  const b = req.body || {};
  const { transaction, duplicate } = store.saveTransaction({
    externalId: b.externalId || `MANUAL-${Date.now()}`,
    productName: b.productName, amount: b.amount,
    buyerName: b.buyerName, buyerContact: b.buyerContact,
    status: b.status || 'pending', source: 'manual',
  });
  res.json({ ok: true, duplicate, data: transaction });
});
app.post('/api/transactions/:id/status', (req, res) => {
  const tx = store.mem.transactions.find((t) => String(t.id) === req.params.id);
  if (!tx) return res.status(404).json({ ok: false, error: 'transaksi tidak ditemukan' });
  tx.status = store.mapPaymentStatus(req.body.status);
  res.json({ ok: true, data: tx });
});

// ---------- Tugas, persetujuan, agen ----------
app.post('/api/tasks', (req, res) => {
  const b = req.body || {};
  const row = { id: store.mem.seq.tasks++, title: b.title || 'Tugas', agent: b.agent || 'manager', status: 'Aktif', createdAt: new Date().toISOString() };
  store.mem.tasks.unshift(row);
  res.json({ ok: true, data: row });
});
app.post('/api/tasks/:id/status', (req, res) => {
  const t = store.mem.tasks.find((x) => String(x.id) === req.params.id);
  if (!t) return res.status(404).json({ ok: false, error: 'tugas tidak ditemukan' });
  t.status = req.body.status || t.status;
  res.json({ ok: true, data: t });
});
app.post('/api/approvals', (req, res) => {
  const b = req.body || {};
  const row = { id: store.mem.seq.approvals++, title: b.title || 'Permintaan persetujuan', status: 'Menunggu', createdAt: new Date().toISOString() };
  store.mem.approvals.unshift(row);
  res.json({ ok: true, data: row });
});
app.post('/api/approvals/:id/decide', (req, res) => {
  const a = store.mem.approvals.find((x) => String(x.id) === req.params.id);
  if (!a) return res.status(404).json({ ok: false, error: 'persetujuan tidak ditemukan' });
  a.status = req.body.decision === 'approve' ? 'Disetujui' : 'Ditolak';
  store.addAuditLog('Persetujuan diputuskan', `${a.title}: ${a.status}`);
  res.json({ ok: true, data: a });
});
app.post('/api/agents/ask', (req, res) => {
  const b = req.body || {};
  const output = agents.askAgent(b.agent || 'manager', b.question || '');
  res.json({ ok: true, data: output });
});
app.get('/api/agents', (_req, res) => res.json({ ok: true, data: agents.AGENTS }));

// ---------- Tes integrasi (mencatat hasil; tidak mengarang panggilan API) ----------
// Tes Lynk.id lulus hanya bila Merchant Key tersimpan. Tes WhatsApp lulus
// hanya bila token + verify token tersimpan; uji webhook asli tetap harus
// dikonfirmasi owner dari log setelah Meta memanggil URL publik.
app.post('/api/test-integration', (req, res) => {
  const kind = req.body.kind;
  const s = store.mem.settings;
  const now = new Date().toISOString();
  if (kind === 'lynk') {
    const pass = Boolean(process.env.LYNK_MERCHANT_KEY || s.lynkMerchantKey);
    s.lynkTestResult = pass ? 'pass' : 'fail';
    s.lynkTestAt = now;
    return res.json({ ok: true, data: { kind, result: s.lynkTestResult, note: pass ? 'Merchant Key tersimpan. Uji webhook asli: kirim payload uji ke /webhook/lynk lalu cek Log Webhook.' : 'Merchant Key belum diisi.' } });
  }
  if (kind === 'whatsapp') {
    const pass = Boolean((process.env.WHATSAPP_ACCESS_TOKEN || s.whatsappAccessToken) && (process.env.WHATSAPP_VERIFY_TOKEN || s.whatsappVerifyToken));
    s.waTestResult = pass ? 'pass' : 'fail';
    s.waTestAt = now;
    return res.json({ ok: true, data: { kind, result: s.waTestResult, note: pass ? 'Token tersimpan. Konfirmasi akhir: verifikasi webhook di Meta harus berhasil dan pesan masuk tercatat di log.' : 'Token / Verify Token WhatsApp belum diisi.' } });
  }
  return res.status(400).json({ ok: false, error: 'kind harus lynk atau whatsapp' });
});

// ---------- Fallback: halaman utama ----------
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`ALNEX AI Virtual Office berjalan di port ${PORT} — GET /health`);
  if (!process.env.DATABASE_URL) {
    // eslint-disable-next-line no-console
    console.log('PERINGATAN: DATABASE_URL kosong — data disimpan di memori dan hilang saat restart. Isi DATABASE_URL dari Supabase untuk produksi.');
  }
  if (!process.env.OWNER_PIN) {
    // eslint-disable-next-line no-console
    console.log('PERINGATAN: OWNER_PIN kosong — API /api terbuka. Isi OWNER_PIN sebelum deploy ke publik.');
  }
});
