/**
 * Penerima webhook Lynk.id dan WhatsApp Business Cloud API.
 *
 * Kontrak (sama dengan artefak Muse yang sudah terverifikasi):
 *  - POST /webhook/lynk
 *      Payload contoh:
 *      {
 *        "event": "transaction",
 *        "transaction_id": "LYNK-TEST-001",
 *        "product_name": "Produk Uji",
 *        "amount": 10000,
 *        "buyer_name": "Penguji",
 *        "buyer_email": "uji@contoh.id",
 *        "status": "paid"
 *      }
 *      Aturan: dedupe berdasarkan transaction_id; hanya status paid/verified
 *      yang dihitung sebagai omzet; pending tersimpan tapi tidak masuk omzet.
 *      Validasi secret: bila LYNK_MERCHANT_KEY terisi di env, payload harus
 *      membawa secret yang cocok — di header `x-merchant-key`, di field
 *      `merchant_key`/`signature`, atau sebagai HMAC-SHA256 dari body mentah
 *      di header `x-lynk-signature`. Bila kunci BELUM terisi, payload diterima
 *      tetapi dicatat jujur "tanpa validasi secret" di webhook_logs.
 *      JANGAN mengarang format signature resmi Lynk.id di luar ini; cek
 *      dokumentasi Lynk.id terbaru saat menghubungkan dan sesuaikan bila perlu.
 *  - GET  /webhook/whatsapp  — verifikasi webhook Meta (hub.mode=subscribe).
 *  - POST /webhook/whatsapp  — pesan masuk; diekstrak dan disimpan ke inbox CS.
 */
'use strict';

const crypto = require('crypto');
const store = require('./store');

function lynkSecretMatches(req, rawBody) {
  const key = process.env.LYNK_MERCHANT_KEY || store.mem.settings.lynkMerchantKey || '';
  if (!key) return { required: false, ok: true, note: 'Merchant Key belum diisi; payload diterima tanpa validasi secret.' };
  const headerKey = req.get('x-merchant-key') || req.get('x-lynk-merchant-key') || '';
  const body = req.body || {};
  const bodySecret = body.merchant_key || body.merchantKey || body.signature || body.sign || '';
  if (headerKey && headerKey === key) return { required: true, ok: true, note: 'Secret cocok (header).' };
  if (bodySecret && bodySecret === key) return { required: true, ok: true, note: 'Secret cocok (body).' };
  const sig = req.get('x-lynk-signature') || req.get('x-hub-signature-256') || '';
  if (sig) {
    const expected = 'sha256=' + crypto.createHmac('sha256', key).update(rawBody || '').digest('hex');
    const expectedPlain = crypto.createHmac('sha256', key).update(rawBody || '').digest('hex');
    if (sig === expected || sig === expectedPlain) return { required: true, ok: true, note: 'Signature HMAC-SHA256 cocok.' };
  }
  return { required: true, ok: false, note: 'Secret/signature tidak cocok atau tidak dibawa, padahal Merchant Key sudah diisi.' };
}

function handleLynkWebhook(req, res) {
  const payload = req.body || {};
  const externalId = payload.transaction_id || payload.transactionId || payload.id || payload.external_id || '';
  const check = lynkSecretMatches(req, req.rawBody || '');
  store.addWebhookLog({
    source: 'lynk',
    event: payload.event || 'transaction',
    externalId,
    payload,
    result: check.ok
      ? `Transaksi diproses. ${check.note}`
      : `DITOLAK: ${check.note}`,
    valid: check.ok ? 1 : 0,
    duplicate: 0,
  });
  if (!check.ok) {
    return res.status(401).json({ ok: false, error: 'unauthorized: secret/signature tidak valid', note: check.note });
  }
  if (!externalId) {
    return res.status(400).json({ ok: false, error: 'transaction_id wajib diisi' });
  }
  const { transaction, duplicate } = store.saveTransaction({
    externalId,
    productName: payload.product_name || payload.productName || payload.product || 'Produk',
    amount: payload.amount || payload.total || payload.price || 0,
    buyerName: payload.buyer_name || payload.buyerName || payload.customer_name || 'Pembeli',
    buyerContact: payload.buyer_email || payload.buyerEmail || payload.buyer_phone || payload.buyerPhone || '',
    status: payload.status || payload.payment_status || 'pending',
    source: 'lynk_webhook',
  });
  if (duplicate) {
    store.addWebhookLog({
      source: 'lynk', event: 'transaction', externalId, payload,
      result: 'Duplikat: transaction_id sudah pernah disimpan, tidak disimpan ulang.',
      valid: 1, duplicate: 1,
    });
    return res.json({ ok: true, duplicate: true, message: 'Transaksi duplikat, tidak disimpan ulang.', transaction });
  }
  store.addAuditLog('Webhook Lynk.id diterima', `Transaksi ${externalId} disimpan dengan status ${transaction.status}. Hanya status verified yang dihitung sebagai omzet.`);
  return res.json({ ok: true, duplicate: false, transaction });
}

function verifyWhatsapp(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = process.env.WHATSAPP_VERIFY_TOKEN || store.mem.settings.whatsappVerifyToken || '';
  if (mode === 'subscribe' && token && expected && token === expected) {
    return res.status(200).send(challenge);
  }
  if (mode === 'subscribe' && !expected) {
    return res.status(403).send('Verify Token belum diisi di server. Isi WHATSAPP_VERIFY_TOKEN lalu ulangi verifikasi di Meta.');
  }
  return res.status(403).send('Verifikasi webhook WhatsApp gagal: token tidak cocok.');
}

function extractWhatsappMessages(payload) {
  const out = [];
  const entries = payload.entry || [];
  entries.forEach((entry) => {
    (entry.changes || []).forEach((change) => {
      const value = change.value || {};
      const contacts = {};
      (value.contacts || []).forEach((c) => { contacts[c.wa_id] = c.profile ? c.profile.name : ''; });
      (value.messages || []).forEach((m) => {
        const body = (m.text && m.text.body) || m.body || '[pesan non-teks]';
        out.push({ from: m.from || '', name: contacts[m.from] || 'Pelanggan', body });
      });
    });
  });
  return out;
}

function handleWhatsappWebhook(req, res) {
  const payload = req.body || {};
  const messages = extractWhatsappMessages(payload);
  if (messages.length === 0) {
    store.addWebhookLog({
      source: 'whatsapp', event: 'message', externalId: '', payload,
      result: 'Payload diterima tetapi tidak berisi pesan pelanggan.',
      valid: 1, duplicate: 0,
    });
    return res.json({ ok: true, received: 0 });
  }
  messages.forEach((m) => {
    store.addMessage({ senderName: m.name, senderContact: m.from, body: m.body, channel: 'whatsapp_webhook' });
    store.addWebhookLog({
      source: 'whatsapp', event: 'message', externalId: m.from, payload,
      result: 'Pesan pelanggan disimpan ke Kotak Masuk CS. Payload JSON valid.',
      valid: 1, duplicate: 0,
    });
  });
  store.addAuditLog('Webhook WhatsApp diterima', `${messages.length} pesan pelanggan disimpan ke Kotak Masuk CS.`);
  return res.json({ ok: true, received: messages.length });
}

module.exports = { handleLynkWebhook, verifyWhatsapp, handleWhatsappWebhook, lynkSecretMatches };
