-- COMPANY WITHDRAWAL REQUESTS
-- Withdrawal requests require administrator approval.
-- Funds remain reserved until the request is paid or rejected.

CREATE TABLE IF NOT EXISTS company_withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  company_id INTEGER NOT NULL,
  wallet_id INTEGER NOT NULL,

  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),

  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN (
      'pending',
      'approved',
      'rejected',
      'processing',
      'paid',
      'failed',
      'cancelled'
    )
  ),

  payout_provider TEXT,
  payout_destination_ref TEXT,
  provider_payout_reference TEXT UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,

  request_note TEXT,
  rejection_reason TEXT,
  failure_reason TEXT,

  requested_at TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  processed_at TEXT,

  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (wallet_id) REFERENCES company_wallets(id)
);

CREATE INDEX IF NOT EXISTS idx_company_withdrawals_company
ON company_withdrawals(company_id, requested_at);

CREATE INDEX IF NOT EXISTS idx_company_withdrawals_status
ON company_withdrawals(status, requested_at);

CREATE INDEX IF NOT EXISTS idx_company_withdrawals_wallet
ON company_withdrawals(wallet_id, status);
