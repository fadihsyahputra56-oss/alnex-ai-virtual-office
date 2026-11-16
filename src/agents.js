/**
 * Agen AI ALNEX — jawaban yang didasarkan pada data tersimpan saja.
 *
 * Prinsip: agen TIDAK mengarang angka, pelanggan, atau transaksi.
 * Semua angka di jawaban berasal dari store.dashboard() / tabel tersimpan.
 * Bila data kosong, agen berkata jujur bahwa belum ada data.
 *
 * Integrasi model AI eksternal (opsional): bila OPENAI_API_KEY terisi,
 * server.js dapat memanggil model itu dengan konteks data tersimpan.
 * Paket ini sengaja tidak mewajibkan kunci AI apa pun — agen tetap
 * berfungsi dengan jawaban berbasis data (rule-based) di bawah ini.
 */
'use strict';

const store = require('./store');

const AGENTS = {
  manager: { name: 'AI Manager', role: 'Mengatur semua agen, membagi tugas, dan membuat laporan untuk owner.' },
  sales: { name: 'AI Sales', role: 'Mengarahkan pelanggan ke https://lynk.id/alnex dan menjawab pertanyaan produk berdasarkan katalog.' },
  marketing: { name: 'AI Marketing', role: 'Membuat caption promosi, strategi pemasaran, dan ide konten dari data yang tersedia.' },
  finance: { name: 'AI Finance', role: 'Mencatat transaksi terverifikasi, menghitung omzet, dan membuat laporan keuangan.' },
  cs: { name: 'AI Customer Service', role: 'Menjawab pertanyaan pelanggan, membantu info pesanan, dan menangani keluhan.' },
};

function idr(n) {
  return 'Rp' + Number(n || 0).toLocaleString('id-ID');
}

function askAgent(agent, question) {
  const a = AGENTS[agent] || AGENTS.manager;
  const d = store.dashboard();
  const q = String(question || '').toLowerCase();
  let answer = '';

  if (agent === 'finance' || q.includes('omzet') || q.includes('keuangan') || q.includes('pendapatan') || q.includes('laporan')) {
    const pending = store.mem.transactions.filter((t) => t.status === 'pending').length;
    answer = `Omzet terverifikasi saat ini ${idr(d.omzet)} dari ${d.orders} transaksi terverifikasi. `
      + (pending ? `${pending} transaksi masih pending dan tidak dihitung sebagai omzet. ` : 'Tidak ada transaksi pending. ')
      + (d.topProducts.length
        ? `Produk terlaris: ${d.topProducts.map((p) => `${p.name} (${p.orders} pesanan, ${idr(p.revenue)})`).join('; ')}.`
        : 'Belum ada produk terlaris karena belum ada transaksi terverifikasi.');
  } else if (agent === 'sales' || q.includes('produk') || q.includes('jual') || q.includes('beli')) {
    const products = store.mem.products;
    answer = products.length
      ? `Katalog produk (${products.length}): ${products.map((p) => `${p.name} — ${idr(p.price)}`).join('; ')}. Pelanggan dapat diarahkan ke https://lynk.id/alnex.`
      : `Katalog produk masih kosong. Tambahkan produk di halaman katalog, lalu pelanggan dapat diarahkan ke https://lynk.id/alnex. Saat ini ada ${d.customers} pelanggan dan ${d.prospects} prospek tercatat.`;
  } else if (agent === 'marketing' || q.includes('promosi') || q.includes('caption') || q.includes('konten') || q.includes('strategi')) {
    const top = d.topProducts[0];
    answer = top
      ? `Ide promosi berdasarkan data: sorot "${top.name}" yang sudah terjual ${top.orders} kali dengan omzet ${idr(top.revenue)}. Contoh caption: "Terlaris di ALNEX: ${top.name} — cek di https://lynk.id/alnex". Performa promosi hanya bisa dianalisis dari data transaksi yang tercatat; tidak ada angka promosi di luar data itu.`
      : 'Belum ada data penjualan untuk dianalisis, jadi saya tidak membuat klaim performa promosi. Setelah ada transaksi terverifikasi, saya bisa menyusun strategi berdasarkan produk terlaris.';
  } else if (agent === 'cs' || q.includes('pelanggan') || q.includes('pesan') || q.includes('keluhan') || q.includes('pesanan')) {
    answer = `Ada ${d.customers} pelanggan tercatat dan ${d.newMessages} pesan baru yang belum dibalas di Kotak Masuk CS. `
      + `Untuk info pesanan, saya hanya menjawab dari transaksi yang tercatat di sistem; bila pesanan tidak ditemukan, saya arahkan pelanggan ke admin.`;
  } else {
    // AI Manager — ringkasan umum dari data nyata.
    answer = `Ringkasan untuk owner: omzet terverifikasi ${idr(d.omzet)} dari ${d.orders} pesanan, ${d.customers} pelanggan, ${d.prospects} prospek, ${d.newMessages} pesan baru, ${d.activeTasks} tugas aktif, dan ${d.pendingApprovals} persetujuan menunggu. `
      + `Integrasi: ${d.integrations.map((i) => `${i.name}: ${i.status}`).join('; ')}.`;
  }

  const output = {
    id: store.mem.seq.agentOutputs++,
    agent,
    agentName: a.name,
    question: String(question || ''),
    answer,
    createdAt: new Date().toISOString(),
  };
  store.mem.agentOutputs.unshift(output);
  return output;
}

module.exports = { AGENTS, askAgent };
