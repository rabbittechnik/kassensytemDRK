import type BetterSqlite3 from 'better-sqlite3'

const MIGRATIONS: string[] = [
  `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'cashier', 'auditor')),
    pin_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES categories(id),
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    vat_rate_percent INTEGER NOT NULL DEFAULT 19,
    stock_tracking INTEGER NOT NULL DEFAULT 0,
    stock_qty INTEGER,
    stock_min INTEGER,
    deposit_enabled INTEGER NOT NULL DEFAULT 0,
    deposit_amount INTEGER NOT NULL DEFAULT 0,
    deposit_name TEXT,
    deposit_type TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category_id);

  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact_name TEXT,
    invoice_email TEXT,
    phone TEXT,
    billing_address TEXT NOT NULL DEFAULT '',
    customer_no TEXT UNIQUE,
    internal_note TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    default_payment_days INTEGER NOT NULL DEFAULT 14,
    cost_center TEXT,
    department TEXT,
    local_group TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(name);
  CREATE INDEX IF NOT EXISTS idx_teams_active ON teams(active);

  CREATE TABLE IF NOT EXISTS team_contacts (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    is_default INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_team_contacts_team ON team_contacts(team_id);

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'closed')),
    created_at INTEGER NOT NULL,
    closed_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);

  CREATE TABLE IF NOT EXISTS invoice_sequences (
    kind TEXT NOT NULL CHECK (kind IN ('RE', 'ST')),
    year INTEGER NOT NULL,
    last_seq INTEGER NOT NULL,
    PRIMARY KEY (kind, year)
  );

  CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    day_key TEXT NOT NULL,
    total_cents INTEGER NOT NULL,
    receipt_no INTEGER NOT NULL UNIQUE,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'card', 'invoice')),
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('open', 'completed')),
    lifecycle_status TEXT NOT NULL DEFAULT 'completed' CHECK (lifecycle_status IN ('open', 'completed', 'cancelled', 'refunded', 'closed_day')),
    cashier_user_id TEXT,
    team_id TEXT REFERENCES teams(id),
    event_id TEXT REFERENCES events(id),
    invoice_contact_snapshot TEXT,
    cashier_note TEXT,
    client_uuid TEXT,
    amount_tendered_cents INTEGER,
    change_cents INTEGER,
    invoice_state TEXT CHECK (invoice_state IN ('open_for_invoicing', 'invoiced', 'na')) DEFAULT 'na',
    is_stornoed INTEGER NOT NULL DEFAULT 0,
    reverses_sale_id TEXT REFERENCES sales(id),
    receipt_pdf_rel_path TEXT,
    tse_status TEXT DEFAULT 'inactive',
    tse_transaction_number TEXT,
    tse_start_time INTEGER,
    tse_end_time INTEGER,
    tse_signature_counter INTEGER,
    tse_signature TEXT,
    tse_serial_number TEXT,
    tse_process_type TEXT,
    tse_process_data TEXT,
    tax_mode_snapshot TEXT,
    cashier_name_snapshot TEXT,
    deposit_total_cents INTEGER NOT NULL DEFAULT 0,
    UNIQUE (client_uuid)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_uuid ON sales(client_uuid)
    WHERE client_uuid IS NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_sales_day ON sales(day_key);
  CREATE INDEX IF NOT EXISTS idx_sales_team_event ON sales(team_id, event_id);
  CREATE INDEX IF NOT EXISTS idx_sales_invoice_state ON sales(invoice_state);

  CREATE TABLE IF NOT EXISTS sale_lines (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES sales(id),
    category_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    name TEXT NOT NULL,
    qty INTEGER NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    line_total_cents INTEGER NOT NULL,
    vat_rate_percent INTEGER NOT NULL DEFAULT 19,
    deposit_amount_cents INTEGER NOT NULL DEFAULT 0,
    deposit_name_snapshot TEXT,
    deposit_qty INTEGER NOT NULL DEFAULT 0,
    deposit_total_cents INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_sale_lines_sale ON sale_lines(sale_id);

  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    invoice_no TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('normal', 'storno', 'correction')),
    references_invoice_id TEXT REFERENCES invoices(id),
    team_id TEXT NOT NULL REFERENCES teams(id),
    event_id TEXT NOT NULL REFERENCES events(id),
    status TEXT NOT NULL,
    issue_date TEXT NOT NULL,
    service_period_start TEXT NOT NULL,
    service_period_end TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'EUR',
    subtotal_cents INTEGER NOT NULL,
    vat_breakdown_json TEXT NOT NULL DEFAULT '[]',
    total_cents INTEGER NOT NULL,
    payment_terms_days INTEGER NOT NULL,
    due_date TEXT NOT NULL,
    issuer_snapshot_json TEXT NOT NULL DEFAULT '{}',
    recipient_snapshot_json TEXT NOT NULL DEFAULT '{}',
    tax_settings_snapshot_json TEXT NOT NULL DEFAULT '{}',
    aggregated_lines_json TEXT NOT NULL DEFAULT '[]',
    optional_detail_attachment_json TEXT,
    structured_payload_json TEXT NOT NULL DEFAULT '{}',
    pdf_rel_path TEXT NOT NULL,
    paid_cents INTEGER NOT NULL DEFAULT 0,
    cancelled_at INTEGER,
    storno_reason TEXT,
    storno_invoice_id TEXT REFERENCES invoices(id),
    created_at INTEGER NOT NULL,
    sent_at INTEGER,
    paid_full_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_invoices_team_event ON invoices(team_id, event_id);
  CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

  CREATE TABLE IF NOT EXISTS invoice_sale_links (
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    sale_id TEXT NOT NULL REFERENCES sales(id) UNIQUE,
    PRIMARY KEY (invoice_id, sale_id)
  );

  CREATE TABLE IF NOT EXISTS invoice_payments (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    paid_at INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    method TEXT NOT NULL DEFAULT 'transfer',
    note TEXT,
    bank_reference TEXT,
    created_by_user_id TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_invoice_payments_inv ON invoice_payments(invoice_id);

  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    type TEXT NOT NULL,
    user_id TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at);

  CREATE TABLE IF NOT EXISTS sale_reprints (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES sales(id),
    reprinted_at INTEGER NOT NULL,
    user_id TEXT,
    reason TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_sale_reprints_sale ON sale_reprints(sale_id);

  CREATE TABLE IF NOT EXISTS deposit_vouchers (
    id TEXT PRIMARY KEY,
    voucher_number TEXT NOT NULL UNIQUE,
    sale_id TEXT NOT NULL REFERENCES sales(id),
    event_id TEXT REFERENCES events(id),
    amount_cents INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open','redeemed','cancelled')) DEFAULT 'open',
    issued_at INTEGER NOT NULL,
    redeemed_at INTEGER,
    redeemed_by TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_deposit_vouchers_sale ON deposit_vouchers(sale_id);
  CREATE INDEX IF NOT EXISTS idx_deposit_vouchers_status ON deposit_vouchers(status);

  CREATE TABLE IF NOT EXISTS deposit_redemptions (
    id TEXT PRIMARY KEY,
    voucher_id TEXT REFERENCES deposit_vouchers(id),
    event_id TEXT REFERENCES events(id),
    amount_cents INTEGER NOT NULL,
    deposit_name TEXT,
    deposit_type TEXT,
    quantity INTEGER NOT NULL,
    total_cents INTEGER NOT NULL DEFAULT 0,
    cashier TEXT,
    redeemed_at INTEGER NOT NULL,
    created_at INTEGER,
    note TEXT,
    mode TEXT NOT NULL DEFAULT 'voucher'
  );

  CREATE INDEX IF NOT EXISTS idx_deposit_redemptions_voucher ON deposit_redemptions(voucher_id);

  CREATE TABLE IF NOT EXISTS helpers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    team TEXT,
    role TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_helpers_name ON helpers(name);
  CREATE INDEX IF NOT EXISTS idx_helpers_active ON helpers(active);

  CREATE TABLE IF NOT EXISTS helper_consumptions (
    id TEXT PRIMARY KEY,
    helper_id TEXT REFERENCES helpers(id),
    helper_name_snapshot TEXT NOT NULL,
    helper_group TEXT NOT NULL DEFAULT 'Helfer allgemein',
    consumption_type TEXT NOT NULL DEFAULT 'helper_general',
    event_id TEXT REFERENCES events(id),
    sale_like_number TEXT NOT NULL UNIQUE,
    total_value_cents INTEGER NOT NULL,
    payment_total_cents INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    cashier TEXT,
    note TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_helper_consumptions_event ON helper_consumptions(event_id);
  CREATE INDEX IF NOT EXISTS idx_helper_consumptions_created ON helper_consumptions(created_at);

  CREATE TABLE IF NOT EXISTS helper_consumption_items (
    id TEXT PRIMARY KEY,
    helper_consumption_id TEXT NOT NULL REFERENCES helper_consumptions(id),
    product_id TEXT NOT NULL,
    product_name_snapshot TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price_snapshot_cents INTEGER NOT NULL,
    total_value_cents INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_helper_consumption_items_parent ON helper_consumption_items(helper_consumption_id);

  CREATE TABLE IF NOT EXISTS day_closings (
    id TEXT PRIMARY KEY,
    closing_number INTEGER NOT NULL UNIQUE,
    day_key TEXT NOT NULL,
    period_start INTEGER NOT NULL,
    period_end INTEGER NOT NULL,
    gross_total_cents INTEGER NOT NULL,
    cash_total_cents INTEGER NOT NULL,
    card_total_cents INTEGER NOT NULL,
    invoice_total_cents INTEGER NOT NULL,
    deposit_collected_cents INTEGER NOT NULL DEFAULT 0,
    deposit_paid_out_cents INTEGER NOT NULL DEFAULT 0,
    deposit_balance_cents INTEGER NOT NULL DEFAULT 0,
    storno_count INTEGER NOT NULL DEFAULT 0,
    storno_total_cents INTEGER NOT NULL DEFAULT 0,
    sales_count INTEGER NOT NULL DEFAULT 0,
    users_json TEXT NOT NULL DEFAULT '[]',
    by_category_json TEXT NOT NULL DEFAULT '[]',
    expected_cash_drawer_cents INTEGER,
    actual_cash_drawer_cents INTEGER,
    drawer_diff_cents INTEGER,
    csv_rel_path TEXT NOT NULL,
    pdf_rel_path TEXT NOT NULL,
    created_by_user_id TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_day_closings_day ON day_closings(day_key);
  `,
]

function ensureColumn(
  db: BetterSqlite3.Database,
  table: string,
  column: string,
  definition: string,
) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

export function migrate(db: BetterSqlite3.Database) {
  for (const sql of MIGRATIONS) {
    db.exec(sql)
  }
  ensureColumn(db, 'products', 'stock_tracking', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'products', 'stock_qty', 'INTEGER')
  ensureColumn(db, 'products', 'stock_min', 'INTEGER')
  ensureColumn(db, 'products', 'deposit_enabled', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'products', 'deposit_amount', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'products', 'deposit_name', 'TEXT')
  ensureColumn(db, 'products', 'deposit_type', 'TEXT')
  ensureColumn(db, 'sales', 'tse_start_time', 'INTEGER')
  ensureColumn(db, 'sales', 'tse_end_time', 'INTEGER')
  ensureColumn(db, 'sales', 'tse_signature_counter', 'INTEGER')
  ensureColumn(db, 'sales', 'tse_signature', 'TEXT')
  ensureColumn(db, 'sales', 'tse_serial_number', 'TEXT')
  ensureColumn(db, 'sales', 'tse_process_type', 'TEXT')
  ensureColumn(db, 'sales', 'tse_process_data', 'TEXT')
  ensureColumn(
    db,
    'sales',
    'lifecycle_status',
    "TEXT NOT NULL DEFAULT 'completed' CHECK (lifecycle_status IN ('open', 'completed', 'cancelled', 'refunded', 'closed_day'))",
  )
  ensureColumn(db, 'teams', 'short_name', 'TEXT')
  ensureColumn(db, 'sales', 'deposit_total_cents', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'sale_lines', 'deposit_amount_cents', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'sale_lines', 'deposit_name_snapshot', 'TEXT')
  ensureColumn(db, 'sale_lines', 'deposit_qty', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'sale_lines', 'deposit_total_cents', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'deposit_redemptions', 'event_id', 'TEXT')
  ensureColumn(db, 'deposit_redemptions', 'deposit_name', 'TEXT')
  ensureColumn(db, 'deposit_redemptions', 'deposit_type', 'TEXT')
  ensureColumn(db, 'deposit_redemptions', 'total_cents', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'deposit_redemptions', 'created_at', 'INTEGER')
  ensureColumn(db, 'deposit_redemptions', 'mode', "TEXT NOT NULL DEFAULT 'voucher'")
  db.exec(`UPDATE deposit_redemptions SET total_cents = amount_cents WHERE COALESCE(total_cents, 0) = 0`)
  db.exec(`UPDATE deposit_redemptions SET created_at = redeemed_at WHERE created_at IS NULL`)
  migrateDepositRedemptionsIfNeeded(db)
  ensureColumn(
    db,
    'helper_consumptions',
    'helper_group',
    "TEXT NOT NULL DEFAULT 'Helfer allgemein'",
  )
  ensureColumn(
    db,
    'helper_consumptions',
    'consumption_type',
    "TEXT NOT NULL DEFAULT 'helper_general'",
  )
  migrateEventsSchemaIfNeeded(db)
  ensureColumn(db, 'day_closings', 'event_id', 'TEXT')
  ensureColumn(db, 'day_closings', 'deposit_collected_cents', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'day_closings', 'deposit_paid_out_cents', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'day_closings', 'deposit_balance_cents', 'INTEGER NOT NULL DEFAULT 0')
  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('active_event_id', '')`).run()
  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('allow_sales_without_event', '1')`).run()
  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('deposit_feature_enabled', '1')`).run()
  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('deposit_default_amount', '25')`).run()
  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('deposit_auto_print_voucher', '1')`).run()
  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('deposit_print_redemption_receipt', '0')`).run()
  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('deposit_show_on_output_bons', '0')`).run()
  db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('helpers_deposit_enabled', '0')`).run()
}

/** Erweitert events (Status planned/active/completed/archived, Zeiten, Ort, …). */
function migrateEventsSchemaIfNeeded(db: BetterSqlite3.Database) {
  const cols = db.prepare(`PRAGMA table_info(events)`).all() as Array<{ name: string }>
  if (cols.length === 0) return
  if (cols.some((c) => c.name === 'updated_at')) return

  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN TRANSACTION;
    CREATE TABLE events_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      location TEXT,
      description TEXT,
      status TEXT NOT NULL CHECK (status IN ('planned', 'active', 'completed', 'archived')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      closed_at INTEGER
    );
    INSERT INTO events_new (
      id, name, start_date, end_date, start_time, end_time, location, description,
      status, created_at, updated_at, closed_at
    )
    SELECT
      id, name, start_date, end_date, NULL, NULL, NULL, NULL,
      CASE WHEN status = 'closed' THEN 'completed' ELSE 'active' END,
      created_at,
      COALESCE(closed_at, created_at),
      closed_at
    FROM events;
    DROP TABLE events;
    ALTER TABLE events_new RENAME TO events;
    CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
    COMMIT;
    PRAGMA foreign_keys = ON;
  `)
}

function migrateDepositRedemptionsIfNeeded(db: BetterSqlite3.Database) {
  const cols = db.prepare(`PRAGMA table_info(deposit_redemptions)`).all() as Array<{
    name: string
    notnull: number
  }>
  if (cols.length === 0) return
  const voucher = cols.find((c) => c.name === 'voucher_id')
  if (!voucher || voucher.notnull === 0) return
  db.exec(`
    PRAGMA foreign_keys = OFF;
    BEGIN TRANSACTION;
    CREATE TABLE deposit_redemptions_new (
      id TEXT PRIMARY KEY,
      voucher_id TEXT REFERENCES deposit_vouchers(id),
      event_id TEXT REFERENCES events(id),
      amount_cents INTEGER NOT NULL,
      deposit_name TEXT,
      deposit_type TEXT,
      quantity INTEGER NOT NULL,
      total_cents INTEGER NOT NULL DEFAULT 0,
      cashier TEXT,
      redeemed_at INTEGER NOT NULL,
      created_at INTEGER,
      note TEXT,
      mode TEXT NOT NULL DEFAULT 'voucher'
    );
    INSERT INTO deposit_redemptions_new (
      id, voucher_id, event_id, amount_cents, deposit_name, deposit_type, quantity, total_cents, cashier,
      redeemed_at, created_at, note, mode
    )
    SELECT
      id,
      voucher_id,
      NULL,
      amount_cents,
      NULL,
      NULL,
      quantity,
      COALESCE(NULLIF(total_cents, 0), amount_cents),
      cashier,
      redeemed_at,
      COALESCE(created_at, redeemed_at),
      note,
      COALESCE(mode, 'voucher')
    FROM deposit_redemptions;
    DROP TABLE deposit_redemptions;
    ALTER TABLE deposit_redemptions_new RENAME TO deposit_redemptions;
    CREATE INDEX IF NOT EXISTS idx_deposit_redemptions_voucher ON deposit_redemptions(voucher_id);
    COMMIT;
    PRAGMA foreign_keys = ON;
  `)
}
