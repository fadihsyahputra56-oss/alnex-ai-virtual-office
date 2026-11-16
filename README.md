# ALNEX AI Virtual Office — Paket Deploy

Owner: **Fadil A.I.**
Toko: **https://lynk.id/alnex**

Paket ini adalah **source code mandiri** dari aplikasi ALNEX AI Virtual Office
(dashboard bisnis + agen AI + penerima webhook Lynk.id dan WhatsApp).
Paket ini dibuat karena source code artefak Muse tidak bisa diekspor langsung,
jadi paket inilah yang di-push ke GitHub dan di-deploy ke Render.

> **Jujur dulu:** integrasi Lynk.id dan WhatsApp di sini berstatus
> **"Belum terhubung"** sampai kredensial asli dimasukkan dan pengujian
> berhasil. Tidak ada API Lynk.id yang dikarang, tidak ada URL webhook
> publik yang dikarang, dan tidak ada angka omzet contoh. Data mulai
> kosong dan hanya terisi dari webhook / input Anda sendiri.

---

## Isi paket

| File / folder | Isi |
|---|---|
| `server.js` | Server Express: dashboard, API, agen AI, webhook |
| `src/store.js` | Penyimpanan + aturan bisnis (dedupe, omzet hanya verified) |
| `src/webhooks.js` | Penerima `POST /webhook/lynk` dan `GET/POST /webhook/whatsapp` |
| `src/agents.js` | Agen AI Manager/Sales/Marketing/Finance/CS (menjawab dari data tersimpan) |
| `public/index.html` | Dashboard web sederhana |
| `db/schema.sql` | Skema PostgreSQL untuk Supabase |
| `render.yaml` | Blueprint Render (web service, free tier) |
| `.env.example` | Nama environment variables saja — tanpa nilai asli |
| `test/webhook.test.js` | Tes logika webhook (dedupe, paid vs pending) |

## Aturan bisnis yang ditegakkan

1. **Dedupe:** `transaction_id` yang sama hanya tersimpan satu kali.
   Pengiriman ulang dikembalikan sebagai duplikat dan tidak disimpan ulang.
2. **Omzet hanya dari transaksi terverifikasi:** status `paid`/`verified`
   disimpan sebagai `verified` dan masuk omzet. Status `pending`
   tersimpan, tetapi **tidak masuk omzet**.
3. **Log mentah:** setiap payload webhook dicatat di `webhook_logs`
   (termasuk apakah validasi secret lolos atau tidak).
4. **Validasi secret:** bila `LYNK_MERCHANT_KEY` terisi, payload harus
   membawa secret yang cocok (header `x-merchant-key`, field
   `merchant_key`/`signature`, atau HMAC-SHA256 di header
   `x-lynk-signature`). Bila kunci belum terisi, payload diterima
   tetapi dicatat jujur "tanpa validasi secret" — isi kunci sebelum
   mengandalkan webhook ini.
5. **Secret tidak pernah tampil utuh:** API `/api/settings` hanya
   mengembalikan 4 karakter terakhir secret.

---

## Langkah 1 — Push kode ke GitHub

Lakukan sekali saja, dari komputer Anda (atau dari terminal mana pun
yang sudah login GitHub). Ganti `USERNAME_ANDA` dengan username GitHub Anda.

```bash
cd alnex-ai-virtual-office-deploy
git init
git add .
git commit -m "ALNEX AI Virtual Office v1"
git branch -M main
git remote add origin https://github.com/USERNAME_ANDA/alnex-ai-virtual-office.git
git push -u origin main
```

Bila repo `alnex-ai-virtual-office` belum ada di GitHub, buat dulu di
github.com/new dengan nama yang sama, **tanpa** README/.gitignore/license
(agar tidak bentrok dengan file yang sudah ada di paket ini).

> Jangan pernah commit file `.env` yang berisi secret asli.
> File `.gitignore` di paket ini sudah mengecualikan `.env`.

## Langkah 2 — Buat database di Supabase

1. Buka [supabase.com](https://supabase.com) dan buat project baru.
2. Di project itu, buka **SQL Editor** > **New query**.
3. Tempel seluruh isi file `db/schema.sql`, lalu klik **Run**.
4. Buka **Settings > Database**, salin **Connection string** (URI).
   Itulah nilai `DATABASE_URL` Anda. Formatnya:
   `postgresql://postgres:PASSWORD@db.PROYEK.supabase.co:5432/postgres`
5. Simpan password database itu baik-baik — jangan dibagikan di chat.

Tanpa langkah ini aplikasi tetap jalan, tetapi data hanya tersimpan
di memori dan **hilang setiap kali server restart**.

## Langkah 3 — Deploy ke Render

1. Buka [render.com](https://render.com) dan login (bisa lewat Google).
2. Klik **New +** > **Web Service** > hubungkan repo GitHub
   `alnex-ai-virtual-office` yang dibuat di Langkah 1.
   (Alternatif: **New +** > **Blueprint**, lalu pilih file `render.yaml`
   di repo ini.)
3. Isi pengaturan service:
   - **Name:** `alnex-ai-virtual-office`
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** `Free`
4. Di **Environment**, isi environment variables berikut
   (nilai asli, jangan tulis di file atau di chat):
   - `DATABASE_URL` — connection string Supabase dari Langkah 2
   - `OWNER_PIN` — PIN pilihan Anda untuk melindungi endpoint `/api/*`
   - `LYNK_MERCHANT_KEY` — Merchant Key dari dashboard Lynk.id
   - `WHATSAPP_VERIFY_TOKEN` — token verifikasi yang Anda buat sendiri
   - `WHATSAPP_ACCESS_TOKEN` — token permanen dari aplikasi Meta
   - `WHATSAPP_PHONE_NUMBER_ID` — ID nomor WhatsApp Business Anda
5. Klik **Create Web Service** dan tunggu sampai status **Live**.
6. Buka `https://<nama-service>.onrender.com/health`
   — harus menjawab `{"ok": true, ...}`.
   **URL publik inilah yang baru boleh disalin.** Sebelum deploy
   berhasil, tidak ada URL webhook yang bisa disalin.

> Catatan Render free tier: service bisa "tidur" setelah lama tidak
> dipakai dan butuh beberapa puluh detik untuk bangun saat pertama
> dipanggil. Itu normal di paket gratis.

## Langkah 4 — Sambungkan Lynk.id

1. Buka dashboard Lynk.id Anda.
2. Buka **Settings > Integrations > Webhook** (nama menu bisa
   berbeda sedikit mengikuti tampilan Lynk.id terbaru).
3. Tempel URL webhook Anda:
   `https://<nama-service>.onrender.com/webhook/lynk`
   Ganti `<nama-service>` dengan nama service Render Anda.
4. Isi Merchant Key yang sama dengan `LYNK_MERCHANT_KEY` di Render.
5. Simpan, lalu lakukan **pembelian uji** atau kirim payload uji
   (lihat Langkah 6).

## Langkah 5 — Sambungkan WhatsApp Business Cloud API

1. Buka [Meta for Developers](https://developers.facebook.com),
   buka aplikasi WhatsApp Anda.
2. Di **WhatsApp > Configuration**, isi:
   - **Callback URL:** `https://<nama-service>.onrender.com/webhook/whatsapp`
   - **Verify Token:** sama dengan `WHATSAPP_VERIFY_TOKEN` di Render.
3. Klik **Verify and save**. Bila gagal, periksa lagi tokennya —
   server menolak bila token tidak cocok.
4. Subscribe ke field `messages` agar pesan pelanggan masuk.

## Langkah 6 — Uji webhook dan cek log

Uji dari terminal (ganti URL dengan URL Render Anda):

```bash
# 1) Transaksi paid — harus tersimpan sebagai verified dan masuk omzet
curl -X POST https://<nama-service>.onrender.com/webhook/lynk \
  -H "Content-Type: application/json" \
  -d '{"event":"transaction","transaction_id":"LYNK-TEST-001","product_name":"Produk Uji","amount":10000,"buyer_name":"Penguji","buyer_email":"uji@contoh.id","status":"paid"}'

# 2) Kirim payload yang sama lagi — harus dijawab duplicate, tidak dobel
curl -X POST https://<nama-service>.onrender.com/webhook/lynk \
  -H "Content-Type: application/json" \
  -d '{"event":"transaction","transaction_id":"LYNK-TEST-001","product_name":"Produk Uji","amount":10000,"buyer_name":"Penguji","buyer_email":"uji@contoh.id","status":"paid"}'

# 3) Transaksi pending — harus tersimpan tetapi TIDAK masuk omzet
curl -X POST https://<nama-service>.onrender.com/webhook/lynk \
  -H "Content-Type: application/json" \
  -d '{"event":"transaction","transaction_id":"LYNK-TEST-002","product_name":"Produk Uji","amount":99000,"buyer_name":"Penguji","buyer_email":"uji@contoh.id","status":"pending"}'

# 4) Cek dashboard — omzet harus Rp10.000 (bukan Rp109.000)
curl https://<nama-service>.onrender.com/api/dashboard
```

Setelah pengujian, buka dashboard aplikasi dan periksa:
- **Transaksi & Keuangan:** hanya transaksi verified yang masuk omzet.
- **Log Webhook:** setiap pengiriman tercatat, termasuk duplikatnya.
- **Kotak Masuk CS:** pesan WhatsApp uji tercatat setelah dikirim dari WhatsApp.

**Penting:** data uji di atas (`LYNK-TEST-001`, "Produk Uji", Rp10.000)
bukan penjualan asli. Setelah pengujian selesai, hapus transaksi uji
itu dari database / dashboard agar omzet kembali ke angka asli.

## Langkah 7 — Tes lokal (opsional, sebelum deploy)

```bash
npm install
npm test        # tes dedupe + paid vs pending, tanpa database
npm start       # jalan di http://localhost:3000
curl http://localhost:3000/health
```

Tanpa `DATABASE_URL`, data tersimpan di memori dan hilang saat restart.
Itu cukup untuk tes, tidak cukup untuk produksi.

---

## API ringkas

| Method & path | Fungsi |
|---|---|
| `GET /health` | Cek server hidup |
| `POST /webhook/lynk` | Terima notifikasi transaksi Lynk.id |
| `GET /webhook/whatsapp` | Verifikasi webhook Meta |
| `POST /webhook/whatsapp` | Terima pesan pelanggan WhatsApp |
| `GET /api/dashboard` | Omzet verified, pesanan, pelanggan, grafik, status integrasi |
| `GET /api/transactions` | Daftar transaksi |
| `GET /api/customers` | Database pelanggan |
| `GET /api/products` | Katalog produk |
| `GET /api/messages` | Kotak masuk CS |
| `GET /api/webhook-logs` | Log webhook |
| `GET /api/audit-logs` | Audit log keamanan |
| `GET /api/settings` | Pengaturan (secret termasking) |
| `POST /api/settings` | Simpan pengaturan (field secret kosong = pertahankan lama) |
| `POST /api/agents/ask` | Tanya agen AI (`manager`/`sales`/`marketing`/`finance`/`cs`) |
| `POST /api/test-integration` | Catat hasil tes koneksi (`{"kind":"lynk"}` / `{"kind":"whatsapp"}`) |

Bila `OWNER_PIN` terisi, semua endpoint `/api/*` meminta header
`x-owner-pin` dengan PIN yang sama. Webhook dan `/health` tetap
terbuka agar Lynk.id / Meta bisa memanggilnya.

---

## Yang belum otomatis

- **Lynk.id tidak punya API publik untuk menambah produk.** Produk
  tetap ditambahkan manual di dashboard Lynk.id / lewat browser.
  Webhook di sini hanya menerima notifikasi transaksi yang sudah terjadi.
- **Format signature resmi Lynk.id** dapat berubah. Bila Lynk.id
  memakai format signature tertentu (misalnya HMAC-SHA256 atas body
  dengan Merchant Key), sesuaikan fungsi `lynkSecretMatches` di
  `src/webhooks.js` dengan dokumentasi Lynk.id terbaru.
- **Agen AI di paket ini menjawab dari data tersimpan** (rule-based).
  Bila ingin jawaban model AI eksternal, isi `OPENAI_API_KEY` dan
  sambungkan pemanggilan model di `src/agents.js` dengan konteks
  data tersimpan yang sama — tetap tanpa mengarang angka.
