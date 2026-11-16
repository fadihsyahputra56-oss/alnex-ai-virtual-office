/**
 * Tes logika webhook ALNEX — tanpa database, tanpa jaringan.
 * Jalankan: npm test
 *
 * Yang diuji (kontrak yang sudah terverifikasi di artefak Muse):
 *  1. Transaksi paid tersimpan sebagai verified dan masuk omzet.
 *  2. Transaction_id yang sama dikirim dua kali -> duplikat, tidak disimpan ulang.
 *  3. Transaksi pending tersimpan tetapi TIDAK masuk omzet.
 *  4. Pesan WhatsApp tersimpan ke inbox CS.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../src/store');
const webhooks = require('../src/webhooks');

function mockReq(body, headers = {}) {
  return {
    body,
    rawBody: JSON.stringify(body),
    get: (name) => headers[name.toLowerCase()] || '',
  };
}
function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.payload = null;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.payload = obj; return res; };
  return res;
}

test('paid disimpan verified dan masuk omzet; duplikat ditolak; pending tidak masuk omzet', () => {
  // Mulai dari keadaan kosong (tes ini jalan di proses node baru).
  assert.equal(store.mem.transactions.length, 0);

  const paid = {
    event: 'transaction', transaction_id: 'LYNK-TEST-001',
    product_name: 'Produk Uji', amount: 10000,
    buyer_name: 'Penguji', buyer_email: 'uji@contoh.id', status: 'paid',
  };
  const res1 = mockRes();
  webhooks.handleLynkWebhook(mockReq(paid), res1);
  assert.equal(res1.statusCode, 200);
  assert.equal(res1.payload.duplicate, false);
  assert.equal(res1.payload.transaction.status, 'verified');
  assert.equal(store.dashboard().omzet, 10000);
  assert.equal(store.dashboard().orders, 1);

  // Kirim ulang ID yang sama -> duplikat.
  const res2 = mockRes();
  webhooks.handleLynkWebhook(mockReq(paid), res2);
  assert.equal(res2.payload.duplicate, true);
  assert.equal(store.mem.transactions.length, 1);
  assert.equal(store.dashboard().omzet, 10000);

  // Pending: tersimpan, tidak masuk omzet.
  const pending = { ...paid, transaction_id: 'LYNK-TEST-002', amount: 99000, status: 'pending' };
  const res3 = mockRes();
  webhooks.handleLynkWebhook(mockReq(pending), res3);
  assert.equal(res3.payload.transaction.status, 'pending');
  assert.equal(store.mem.transactions.length, 2);
  assert.equal(store.dashboard().omzet, 10000);
  assert.equal(store.dashboard().pendingOrders, 1);
});

test('pesan WhatsApp tersimpan ke inbox CS', () => {
  const payload = {
    entry: [{ changes: [{ value: {
      contacts: [{ wa_id: '6281200000000', profile: { name: 'Penguji' } }],
      messages: [{ from: '6281200000000', type: 'text', text: { body: 'Halo, produknya masih tersedia?' } }],
    } }] }],
  };
  const res = mockRes();
  webhooks.handleWhatsappWebhook(mockReq(payload), res);
  assert.equal(res.payload.received, 1);
  assert.equal(store.mem.messages[0].body, 'Halo, produknya masih tersedia?');
  assert.equal(store.mem.messages[0].status, 'Baru');
});
