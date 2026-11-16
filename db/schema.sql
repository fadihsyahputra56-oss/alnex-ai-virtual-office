-- ============================================================
-- ALNEX AI Virtual Office — skema database (Supabase / PostgreSQL)
-- Owner: Fadil A.I.  Toko: https://lynk.id/alnex
-- Cara pakai: di Supabase Dashboard > SQL Editor, tempel seluruh
-- file ini lalu Run. Aman dijalankan ulang (IF NOT EXISTS).
-- ============================================================

create table if not exists transactions (
  id            bigserial primary key,
  external_id   text not null unique,          -- transaction_id Lynk.id (dedupe)
  product_name  text not null default 'Produk',
  amount        numeric not null default 0,    -- rupiah
  buyer_name    text not null default 'Pembeli',
  buyer_contact text not null default '',
  status        text not null default 'pending'
                check (status in ('verified','pending','failed','refunded')),
  source        text not null default 'lynk_webhook',
  occurred_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists idx_transactions_status on transactions (status);
create index if not exists idx_transactions_occurred on transactions (occurred_at desc);

create table if not exists customers (
  id          bigserial primary key,
  name        text not null default 'Pelanggan',
  contact     text not null default '',
  total_spent numeric not null default 0,
  orders      integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_customers_contact on customers (contact);

create table if not exists products (
  id         bigserial primary key,
  name       text not null,
  price      numeric not null default 0,
  url        text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists prospects (
  id         bigserial primary key,
  name       text not null default 'Prospek',
  contact    text not null default '',
  status     text not null default 'Baru',
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id             bigserial primary key,
  sender_name    text not null default 'Pelanggan',
  sender_contact text not null default '',
  body           text not null default '',
  channel        text not null default 'whatsapp_webhook',
  status         text not null default 'Baru',
  ai_reply       text not null default '',
  created_at     timestamptz not null default now()
);
create index if not exists idx_messages_status on messages (status);

create table if not exists tasks (
  id         bigserial primary key,
  title      text not null,
  agent      text not null default 'manager',
  status     text not null default 'Aktif',
  created_at timestamptz not null default now()
);

create table if not exists approvals (
  id         bigserial primary key,
  title      text not null,
  status     text not null default 'Menunggu',
  created_at timestamptz not null default now()
);

create table if not exists agent_outputs (
  id         bigserial primary key,
  agent      text not null,
  agent_name text not null default '',
  question   text not null default '',
  answer     text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists webhook_logs (
  id          bigserial primary key,
  source      text not null,                    -- 'lynk' | 'whatsapp'
  event       text not null default '',
  external_id text not null default '',
  payload     jsonb not null default '{}'::jsonb,
  result      text not null default '',
  valid       boolean not null default true,
  duplicate   boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_webhook_logs_source on webhook_logs (source, created_at desc);

create table if not exists audit_logs (
  id         bigserial primary key,
  action     text not null,
  detail     text not null default '',
  created_at timestamptz not null default now()
);

-- Pengaturan integrasi: satu baris (id=1). Secret disimpan di sini
-- HANYA bila owner mengisinya lewat aplikasi; env vars diutamakan.
-- API tidak pernah mengembalikan secret utuh (hanya 4 karakter terakhir).
create table if not exists settings (
  id                      integer primary key default 1,
  owner_name              text not null default 'Fadil A.I.',
  store_url               text not null default 'https://lynk.id/alnex',
  owner_whatsapp          text not null default '',
  whatsapp_phone_number_id text not null default '',
  lynk_merchant_key       text not null default '',
  whatsapp_access_token   text not null default '',
  whatsapp_verify_token   text not null default '',
  lynk_test_result        text not null default '',
  lynk_test_at            timestamptz,
  wa_test_result          text not null default '',
  wa_test_at              timestamptz,
  updated_at              timestamptz not null default now()
);
insert into settings (id) values (1) on conflict (id) do nothing;

-- Catatan: aturan "omzet hanya dari transaksi verified" ditegakkan di
-- aplikasi (src/store.js), bukan di SQL, agar mudah diaudit:
--   select coalesce(sum(amount),0) from transactions where status='verified';
