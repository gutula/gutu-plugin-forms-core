/** Plugin-owned migrations for forms-core.
 *
 *  Idempotent CREATE TABLE / CREATE INDEX statements. Re-running this
 *  on an existing database is a no-op. */
import { db } from "@gutu-host";

export function migrate(): void {
  db.exec(`
-- Property setters: per-tenant overrides of *built-in* field
    -- properties (label, required, readonly, hidden, defaultValue, options,
    -- helpText, section, position, printHidden, portalHidden). Mirrors
    -- Frappe's Property Setter doctype: instead of forking schemas, you
    -- override a single property of a single field on a single resource.
    -- Scope can broaden later (per-company / per-role) — start with tenant.
    -- Stored generically so adding a new property is one client/server
    -- enum entry, no migration.
    CREATE TABLE IF NOT EXISTS property_setters (
      id           TEXT PRIMARY KEY,
      tenant_id    TEXT NOT NULL,
      resource     TEXT NOT NULL,
      field        TEXT NOT NULL,    -- field name on the resource (built-in or custom)
      property     TEXT NOT NULL,    -- 'label' | 'required' | 'readonly' | 'hidden' | 'helpText' | 'defaultValue' | 'options' | 'section' | 'position' | 'printHidden' | 'portalHidden'
      value        TEXT NOT NULL,    -- JSON-encoded value
      scope        TEXT NOT NULL DEFAULT 'tenant', -- 'tenant' | 'company:<id>' | 'role:<id>'
      reason       TEXT,
      created_by   TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      UNIQUE (tenant_id, resource, field, property, scope)
    );
    CREATE INDEX IF NOT EXISTS property_setters_tr_idx
      ON property_setters(tenant_id, resource);

    -- Naming series: per-resource document numbering patterns. Pattern
    -- supports '.YYYY.', '.YY.', '.MM.', '.DD.', '.FY.' (fiscal year),
    -- '.#####' (zero-padded counter) tokens. Counters are kept per
    -- (tenant, resource, pattern, year-bucket) so YOY resets are clean.
    CREATE TABLE IF NOT EXISTS naming_series (
      id           TEXT PRIMARY KEY,
      tenant_id    TEXT NOT NULL,
      resource     TEXT NOT NULL,
      pattern      TEXT NOT NULL,                 -- e.g. 'INV-.YYYY.-.#####'
      label        TEXT,
      is_default   INTEGER NOT NULL DEFAULT 0,
      created_by   TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      UNIQUE (tenant_id, resource, pattern)
    );
    CREATE INDEX IF NOT EXISTS naming_series_tr_idx
      ON naming_series(tenant_id, resource);

    -- Counters keyed by (tenant, series, bucket). The bucket is derived
    -- from the pattern (e.g. '2026' for .YYYY., '2026-04' for .YYYY.-.MM.).
    CREATE TABLE IF NOT EXISTS naming_series_counters (
      tenant_id    TEXT NOT NULL,
      series_id    TEXT NOT NULL,
      bucket       TEXT NOT NULL,
      counter      INTEGER NOT NULL DEFAULT 0,
      updated_at   TEXT NOT NULL,
      PRIMARY KEY (tenant_id, series_id, bucket)
    );

    -- Print formats: per-resource HTML/Jinja-like templates. Stored as
    -- text + a JSON paper-size + flags (default, letterhead). Render is
    -- a deterministic substitution pass that supports {{ field }},
    -- {{ child.field }}, {% for x in items %}…{% endfor %}, {% if … %}…{% endif %}.
    CREATE TABLE IF NOT EXISTS print_formats (
      id            TEXT PRIMARY KEY,
      tenant_id     TEXT NOT NULL,
      resource      TEXT NOT NULL,
      name          TEXT NOT NULL,
      template      TEXT NOT NULL,
      paper_size    TEXT NOT NULL DEFAULT 'A4',
      orientation   TEXT NOT NULL DEFAULT 'portrait',
      letterhead_id TEXT,
      is_default    INTEGER NOT NULL DEFAULT 0,
      disabled      INTEGER NOT NULL DEFAULT 0,
      created_by    TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      UNIQUE (tenant_id, resource, name)
    );
    CREATE INDEX IF NOT EXISTS print_formats_tr_idx
      ON print_formats(tenant_id, resource);

    -- Letter heads: header/footer assets reused by print formats.
    CREATE TABLE IF NOT EXISTS letter_heads (
      id          TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL,
      name        TEXT NOT NULL,
      header_html TEXT,
      footer_html TEXT,
      is_default  INTEGER NOT NULL DEFAULT 0,
      created_by  TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      UNIQUE (tenant_id, name)
    );

    -- Notification rules: event-driven triggers. Backend evaluates
    -- conditions, renders the body via the same template engine as
    -- print formats, and dispatches via channels (email/in-app/webhook).
    -- Channels are JSON to allow per-channel config (email recipients,
    -- webhook url, etc.).
    CREATE TABLE IF NOT EXISTS notification_rules (
      id            TEXT PRIMARY KEY,
      tenant_id     TEXT NOT NULL,
      name          TEXT NOT NULL,
      resource      TEXT NOT NULL,
      event         TEXT NOT NULL,    -- 'create' | 'update' | 'submit' | 'cancel' | 'value-change' | 'days-after' | 'days-before' | 'cron'
      condition     TEXT,             -- JSON: { field, op, value } expression tree
      trigger_field TEXT,             -- date field for days-after/days-before
      offset_days   INTEGER,
      cron_expr     TEXT,             -- for 'cron' event
      channels      TEXT NOT NULL,    -- JSON: [{kind:'email'|'in-app'|'webhook', config:{…}}]
      subject       TEXT,
      body_template TEXT NOT NULL,
      enabled       INTEGER NOT NULL DEFAULT 1,
      created_by    TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notification_rules_tr_idx
      ON notification_rules(tenant_id, resource);
    CREATE INDEX IF NOT EXISTS notification_rules_enabled_idx
      ON notification_rules(tenant_id, enabled, event);

    -- Chart of Accounts: tenant-scoped tree of GL accounts. Each
    -- account is one of asset|liability|equity|income|expense|contra,
    -- has a normal balance side (debit|credit), and a parent for tree
    -- rollups. is_group=1 accounts cannot post directly (they are
    -- summary nodes); leaf accounts post the actual entries.
    CREATE TABLE IF NOT EXISTS gl_accounts (
      id            TEXT PRIMARY KEY,
      tenant_id     TEXT NOT NULL,
      company_id    TEXT,                 -- optional: per-company COA; null = tenant-shared
      number        TEXT NOT NULL,        -- account number ('1100', '4000.10', …)
      name          TEXT NOT NULL,
      account_type  TEXT NOT NULL,        -- 'asset'|'liability'|'equity'|'income'|'expense'|'contra'
      normal_side   TEXT NOT NULL,        -- 'debit'|'credit'
      currency      TEXT NOT NULL DEFAULT 'USD',
      parent_id     TEXT,
      is_group      INTEGER NOT NULL DEFAULT 0,
      disabled      INTEGER NOT NULL DEFAULT 0,
      description   TEXT,
      created_by    TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      UNIQUE (tenant_id, company_id, number)
    );
    CREATE INDEX IF NOT EXISTS gl_accounts_tc_idx ON gl_accounts(tenant_id, company_id);
    CREATE INDEX IF NOT EXISTS gl_accounts_parent_idx ON gl_accounts(parent_id);

    -- Fiscal periods: tenant-scoped. A period locks GL when 'closed'
    -- so historical balances are immutable. Reopening is a privileged
    -- action audited via the standard pipeline.
    CREATE TABLE IF NOT EXISTS gl_periods (
      id          TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL,
      company_id  TEXT,
      label       TEXT NOT NULL,
      start_date  TEXT NOT NULL,
      end_date    TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'open',  -- 'open'|'closed'
      closed_at   TEXT,
      closed_by   TEXT,
      created_at  TEXT NOT NULL,
      UNIQUE (tenant_id, company_id, label)
    );
    CREATE INDEX IF NOT EXISTS gl_periods_tc_idx ON gl_periods(tenant_id, company_id);

    -- Journals: a logical group of GL entries that balance to zero.
    -- Every journal references one source document (e.g. a Sales
    -- Invoice or a manual Journal Entry) so postings are traceable.
    -- 'reverses_journal_id' is non-null for reversing journals; the
    -- entries on a reversed journal sum to the negation of the
    -- original, preserving the immutability of GL entries.
    CREATE TABLE IF NOT EXISTS gl_journals (
      id                  TEXT PRIMARY KEY,
      tenant_id           TEXT NOT NULL,
      company_id          TEXT,
      number              TEXT NOT NULL,            -- naming-series allocated
      posting_date        TEXT NOT NULL,
      memo                TEXT,
      source_resource     TEXT,                     -- e.g. 'accounting.invoice'
      source_record_id    TEXT,
      reverses_journal_id TEXT,                     -- if this journal reverses another
      idempotency_key     TEXT,                     -- callers post idempotently
      status              TEXT NOT NULL DEFAULT 'posted', -- 'posted' is terminal
      total_debit_minor   INTEGER NOT NULL,         -- = total_credit_minor (invariant)
      total_credit_minor  INTEGER NOT NULL,
      currency            TEXT NOT NULL DEFAULT 'USD',
      created_by          TEXT NOT NULL,
      created_at          TEXT NOT NULL,
      UNIQUE (tenant_id, company_id, number),
      UNIQUE (tenant_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS gl_journals_source_idx
      ON gl_journals(tenant_id, source_resource, source_record_id);
    CREATE INDEX IF NOT EXISTS gl_journals_date_idx
      ON gl_journals(tenant_id, company_id, posting_date);

    -- GL entries: immutable, one row per debit or credit line. Each
    -- row belongs to exactly one journal; deleting an entry is never
    -- permitted (use a reversing journal). Amounts are minor units
    -- (cents/paise) to avoid floating-point drift.
    CREATE TABLE IF NOT EXISTS gl_entries (
      id              TEXT PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      company_id      TEXT,
      journal_id      TEXT NOT NULL,
      account_id      TEXT NOT NULL,
      side            TEXT NOT NULL,        -- 'debit'|'credit'
      amount_minor    INTEGER NOT NULL,     -- always positive; side determines sign
      currency        TEXT NOT NULL DEFAULT 'USD',
      party_resource  TEXT,                 -- counter-party (customer/supplier) for AR/AP
      party_id        TEXT,
      cost_center     TEXT,
      project         TEXT,
      memo            TEXT,
      posting_date    TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      FOREIGN KEY (journal_id) REFERENCES gl_journals(id),
      FOREIGN KEY (account_id) REFERENCES gl_accounts(id)
    );
    CREATE INDEX IF NOT EXISTS gl_entries_account_idx
      ON gl_entries(tenant_id, account_id, posting_date);
    CREATE INDEX IF NOT EXISTS gl_entries_journal_idx
      ON gl_entries(journal_id);
    CREATE INDEX IF NOT EXISTS gl_entries_party_idx
      ON gl_entries(tenant_id, party_resource, party_id, posting_date);

    -- Sales Invoice (and Bill — same shape, opposite party): real
    -- line-item model with tax + discount support. Posts to GL via
    -- gl-ledger.postJournal. Idempotency key on (tenant, source key)
    -- so re-submission is safe. Currency is per-document; line amounts
    -- in minor units in that currency.
    CREATE TABLE IF NOT EXISTS sales_invoices (
      id                 TEXT PRIMARY KEY,
      tenant_id          TEXT NOT NULL,
      company_id         TEXT,
      kind               TEXT NOT NULL DEFAULT 'sales',  -- 'sales' | 'purchase'
      number             TEXT NOT NULL,                  -- naming series allocated
      party_resource     TEXT NOT NULL,                  -- 'crm.contact' or 'platform.party'
      party_id           TEXT NOT NULL,
      posting_date       TEXT NOT NULL,
      due_date           TEXT,
      currency           TEXT NOT NULL DEFAULT 'USD',
      subtotal_minor     INTEGER NOT NULL DEFAULT 0,
      discount_minor     INTEGER NOT NULL DEFAULT 0,
      tax_minor          INTEGER NOT NULL DEFAULT 0,
      total_minor        INTEGER NOT NULL DEFAULT 0,
      paid_minor         INTEGER NOT NULL DEFAULT 0,
      status             TEXT NOT NULL DEFAULT 'draft',  -- 'draft'|'submitted'|'paid'|'cancelled'
      gl_journal_id      TEXT,
      memo               TEXT,
      reverses_invoice_id TEXT,
      created_by         TEXT NOT NULL,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL,
      UNIQUE (tenant_id, kind, number)
    );
    CREATE INDEX IF NOT EXISTS sales_invoices_tp_idx
      ON sales_invoices(tenant_id, party_resource, party_id);
    CREATE INDEX IF NOT EXISTS sales_invoices_status_idx
      ON sales_invoices(tenant_id, status, posting_date);

    -- Sales Invoice Items: child rows.
    CREATE TABLE IF NOT EXISTS sales_invoice_items (
      id                TEXT PRIMARY KEY,
      tenant_id         TEXT NOT NULL,
      invoice_id        TEXT NOT NULL,
      position          INTEGER NOT NULL DEFAULT 0,
      item_code         TEXT,
      description       TEXT NOT NULL,
      quantity          REAL NOT NULL DEFAULT 1,
      uom               TEXT NOT NULL DEFAULT 'unit',
      rate_minor        INTEGER NOT NULL,
      discount_pct      REAL NOT NULL DEFAULT 0,
      tax_template_id   TEXT,
      tax_pct           REAL NOT NULL DEFAULT 0,
      net_minor         INTEGER NOT NULL DEFAULT 0,
      tax_amount_minor  INTEGER NOT NULL DEFAULT 0,
      amount_minor      INTEGER NOT NULL DEFAULT 0,
      income_account_id TEXT,
      warehouse_id      TEXT,
      project           TEXT,
      cost_center       TEXT,
      created_at        TEXT NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS sales_invoice_items_inv_idx
      ON sales_invoice_items(invoice_id);

    -- Tax templates: jurisdiction-specific tax rate templates that can
    -- be applied to invoice lines. A template can have several
    -- components (e.g. Federal + State + County), each posting to its
    -- own GL account.
    CREATE TABLE IF NOT EXISTS tax_templates (
      id          TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL,
      name        TEXT NOT NULL,
      description TEXT,
      jurisdiction TEXT,
      is_default  INTEGER NOT NULL DEFAULT 0,
      created_by  TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      UNIQUE (tenant_id, name)
    );

    CREATE TABLE IF NOT EXISTS tax_template_components (
      id              TEXT PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      template_id     TEXT NOT NULL,
      label           TEXT NOT NULL,
      rate_pct        REAL NOT NULL,
      gl_account_id   TEXT,
      compound        INTEGER NOT NULL DEFAULT 0,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (template_id) REFERENCES tax_templates(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS tax_template_components_t_idx
      ON tax_template_components(tenant_id, template_id);

    -- Pricing rules: declarative DSL stored as JSON. The engine matches
    -- a rule against a line context (item, item_group, customer,
    -- customer_group, territory, qty, posting_date) and either applies
    -- a percentage discount or sets a hard rate.
    CREATE TABLE IF NOT EXISTS pricing_rules (
      id              TEXT PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      name            TEXT NOT NULL,
      priority        INTEGER NOT NULL DEFAULT 0,    -- higher wins on conflict
      filters         TEXT NOT NULL,                 -- JSON: { itemCode?, itemGroup?, customerId?, customerGroup?, territory?, minQty?, maxQty?, validFrom?, validTo? }
      action          TEXT NOT NULL,                 -- 'discount-pct' | 'discount-amount' | 'set-rate'
      value_pct       REAL,
      value_minor     INTEGER,
      currency        TEXT NOT NULL DEFAULT 'USD',
      enabled         INTEGER NOT NULL DEFAULT 1,
      created_by      TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS pricing_rules_tenant_idx
      ON pricing_rules(tenant_id, enabled, priority DESC);

    -- Stock Ledger: an immutable transaction log of warehouse moves.
    -- Every Receipt, Issue, Transfer, Manufacture, Repack, Adjustment
    -- records one+ rows. Bins are the cumulative running balance per
    -- (item, warehouse) — derived; cached for fast lookup.
    CREATE TABLE IF NOT EXISTS warehouses (
      id          TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL,
      company_id  TEXT,
      number      TEXT NOT NULL,
      name        TEXT NOT NULL,
      parent_id   TEXT,
      is_group    INTEGER NOT NULL DEFAULT 0,
      disabled    INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      UNIQUE (tenant_id, company_id, number)
    );
    CREATE INDEX IF NOT EXISTS warehouses_tenant_idx
      ON warehouses(tenant_id, company_id);

    CREATE TABLE IF NOT EXISTS stock_items (
      id              TEXT PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      code            TEXT NOT NULL,
      name            TEXT NOT NULL,
      uom             TEXT NOT NULL DEFAULT 'unit',
      valuation_method TEXT NOT NULL DEFAULT 'fifo',  -- 'fifo' | 'moving-average'
      reorder_level   REAL,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      UNIQUE (tenant_id, code)
    );
    CREATE INDEX IF NOT EXISTS stock_items_tenant_idx ON stock_items(tenant_id);

    CREATE TABLE IF NOT EXISTS stock_ledger_entries (
      id              TEXT PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      item_id         TEXT NOT NULL,
      warehouse_id    TEXT NOT NULL,
      kind            TEXT NOT NULL,                  -- 'receipt'|'issue'|'transfer-in'|'transfer-out'|'manufacture'|'adjustment'
      quantity        REAL NOT NULL,                  -- signed: positive in, negative out
      uom             TEXT NOT NULL DEFAULT 'unit',
      conversion      REAL NOT NULL DEFAULT 1,        -- to base UOM
      base_quantity   REAL NOT NULL,                  -- = quantity * conversion (in base UOM)
      rate_minor      INTEGER,                        -- per-base-unit cost on inbound; null on outbound (resolved by FIFO/MA)
      currency        TEXT NOT NULL DEFAULT 'USD',
      value_minor     INTEGER NOT NULL DEFAULT 0,     -- base_quantity * rate_minor (positive in, negative out)
      source_resource TEXT,
      source_record_id TEXT,
      posting_date    TEXT NOT NULL,
      created_at      TEXT NOT NULL,
      FOREIGN KEY (item_id) REFERENCES stock_items(id),
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
    );
    CREATE INDEX IF NOT EXISTS stock_ledger_iw_idx
      ON stock_ledger_entries(tenant_id, item_id, warehouse_id, posting_date);
    CREATE INDEX IF NOT EXISTS stock_ledger_source_idx
      ON stock_ledger_entries(tenant_id, source_resource, source_record_id);

    -- FIFO consumption queue: layers per (item, warehouse) of
    -- remaining inbound quantity at a known cost. Outbound moves
    -- consume from oldest layer first; partial layers are split.
    CREATE TABLE IF NOT EXISTS stock_fifo_layers (
      id            TEXT PRIMARY KEY,
      tenant_id     TEXT NOT NULL,
      item_id       TEXT NOT NULL,
      warehouse_id  TEXT NOT NULL,
      sle_id        TEXT NOT NULL,                  -- the inbound SLE that created this layer
      remaining_qty REAL NOT NULL,
      rate_minor    INTEGER NOT NULL,
      currency      TEXT NOT NULL,
      posted_at     TEXT NOT NULL,                  -- = SLE posting_date for ordering
      FOREIGN KEY (sle_id) REFERENCES stock_ledger_entries(id)
    );
    CREATE INDEX IF NOT EXISTS stock_fifo_iw_idx
      ON stock_fifo_layers(tenant_id, item_id, warehouse_id, posted_at)
      WHERE remaining_qty > 0;

    -- Bins: derived running balance per (item, warehouse). Updated
    -- on every SLE write inside the same transaction so reads are
    -- always consistent.
    CREATE TABLE IF NOT EXISTS stock_bins (
      tenant_id      TEXT NOT NULL,
      item_id        TEXT NOT NULL,
      warehouse_id   TEXT NOT NULL,
      actual_qty     REAL NOT NULL DEFAULT 0,
      reserved_qty   REAL NOT NULL DEFAULT 0,
      ordered_qty    REAL NOT NULL DEFAULT 0,
      valuation_minor INTEGER NOT NULL DEFAULT 0,
      currency       TEXT NOT NULL DEFAULT 'USD',
      updated_at     TEXT NOT NULL,
      PRIMARY KEY (tenant_id, item_id, warehouse_id)
    );

    -- BOM: bill of materials. Multi-level (a BOM line can reference
    -- another item that itself has a BOM). Versioned via
    -- (item_code, version) — only one is_default=1 per (tenant, item_code).
    CREATE TABLE IF NOT EXISTS boms (
      id          TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL,
      item_code   TEXT NOT NULL,
      version     TEXT NOT NULL DEFAULT '1',
      output_qty  REAL NOT NULL DEFAULT 1,
      uom         TEXT NOT NULL DEFAULT 'unit',
      currency    TEXT NOT NULL DEFAULT 'USD',
      labour_minor INTEGER NOT NULL DEFAULT 0,
      overhead_minor INTEGER NOT NULL DEFAULT 0,
      is_default  INTEGER NOT NULL DEFAULT 0,
      enabled     INTEGER NOT NULL DEFAULT 1,
      memo        TEXT,
      created_by  TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      UNIQUE (tenant_id, item_code, version)
    );

    CREATE TABLE IF NOT EXISTS bom_lines (
      id            TEXT PRIMARY KEY,
      tenant_id     TEXT NOT NULL,
      bom_id        TEXT NOT NULL,
      position      INTEGER NOT NULL DEFAULT 0,
      item_code     TEXT NOT NULL,
      description   TEXT,
      quantity      REAL NOT NULL,
      uom           TEXT NOT NULL DEFAULT 'unit',
      rate_minor    INTEGER NOT NULL DEFAULT 0,         -- standard rate when sub-BOM not used
      sub_bom_id    TEXT,                               -- if set, expand at explosion time
      scrap_pct     REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (bom_id) REFERENCES boms(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS bom_lines_bom_idx ON bom_lines(bom_id);

    -- Bank statement import + reconciliation: an imported statement
    -- is a header row with N statement lines. Reconciliation matches
    -- statement lines to GL entries (bank account postings).
    CREATE TABLE IF NOT EXISTS bank_statements (
      id           TEXT PRIMARY KEY,
      tenant_id    TEXT NOT NULL,
      bank_account_id TEXT NOT NULL,                  -- FK to gl_accounts (asset:bank)
      label        TEXT NOT NULL,
      from_date    TEXT NOT NULL,
      to_date      TEXT NOT NULL,
      currency     TEXT NOT NULL,
      opening_minor INTEGER NOT NULL DEFAULT 0,
      closing_minor INTEGER NOT NULL DEFAULT 0,
      created_by   TEXT NOT NULL,
      created_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS bank_statements_acct_idx
      ON bank_statements(tenant_id, bank_account_id, from_date);

    CREATE TABLE IF NOT EXISTS bank_statement_lines (
      id              TEXT PRIMARY KEY,
      tenant_id       TEXT NOT NULL,
      statement_id    TEXT NOT NULL,
      posting_date    TEXT NOT NULL,
      description     TEXT,
      reference       TEXT,
      amount_minor    INTEGER NOT NULL,             -- positive: credit (deposit); negative: debit (payment)
      currency        TEXT NOT NULL,
      matched_entry_id TEXT,                        -- FK to gl_entries.id when matched
      status          TEXT NOT NULL DEFAULT 'unmatched',  -- 'unmatched' | 'matched' | 'ignored'
      created_at      TEXT NOT NULL,
      FOREIGN KEY (statement_id) REFERENCES bank_statements(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS bank_statement_lines_stmt_idx
      ON bank_statement_lines(tenant_id, statement_id, posting_date);
    CREATE INDEX IF NOT EXISTS bank_statement_lines_status_idx
      ON bank_statement_lines(tenant_id, status);

    -- Auto Email Reports: one row per scheduled report send. The
    -- 'frequency' is a cron expression (we re-use the dispatcher's
    -- minimal cron parser). Body is rendered via the template engine
    -- after running the named report. Recipients can be static or a
    -- query-resolvable list.
    CREATE TABLE IF NOT EXISTS auto_email_reports (
      id            TEXT PRIMARY KEY,
      tenant_id     TEXT NOT NULL,
      name          TEXT NOT NULL,
      report_kind   TEXT NOT NULL,                  -- 'gl-trial-balance'|'gl-profit-loss'|'gl-balance-sheet'|'sales-aging'|'stock-balance'|...
      report_args   TEXT,                            -- JSON: filters specific to the report
      cron_expr     TEXT NOT NULL,
      subject_tpl   TEXT NOT NULL,
      body_tpl      TEXT NOT NULL,
      recipients    TEXT NOT NULL,                   -- JSON: string[] of emails
      enabled       INTEGER NOT NULL DEFAULT 1,
      last_run_at   TEXT,
      last_run_status TEXT,
      last_error    TEXT,
      created_by    TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

-- Web Forms: public-facing forms that create records on submit.
    CREATE TABLE IF NOT EXISTS web_forms (
      id            TEXT PRIMARY KEY,
      tenant_id     TEXT NOT NULL,
      slug          TEXT NOT NULL,                   -- public route segment
      title         TEXT NOT NULL,
      description   TEXT,
      target_resource TEXT NOT NULL,
      fields        TEXT NOT NULL,                   -- JSON: FieldSpec[]
      success_message TEXT,
      success_redirect TEXT,
      published     INTEGER NOT NULL DEFAULT 0,
      require_captcha INTEGER NOT NULL DEFAULT 0,
      created_by    TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL,
      UNIQUE (tenant_id, slug)
    );

CREATE TABLE IF NOT EXISTS web_form_submissions (
      id            TEXT PRIMARY KEY,
      tenant_id     TEXT NOT NULL,
      form_id       TEXT NOT NULL,
      payload       TEXT NOT NULL,
      record_id     TEXT,                            -- target resource record id, if created
      submitter_ip  TEXT,
      user_agent    TEXT,
      status        TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'accepted'|'rejected'
      reason        TEXT,
      created_at    TEXT NOT NULL,
      FOREIGN KEY (form_id) REFERENCES web_forms(id) ON DELETE CASCADE
    );

CREATE INDEX IF NOT EXISTS web_form_submissions_form_idx
      ON web_form_submissions(tenant_id, form_id, created_at DESC);
  `);
}
