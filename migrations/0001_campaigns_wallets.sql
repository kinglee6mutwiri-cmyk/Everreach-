-- COMPANY WALLETS: one wallet per company and currency
CREATE TABLE IF NOT EXISTS company_wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    currency TEXT NOT NULL CHECK (
        length(currency) = 3
    ),
    available_balance_minor INTEGER NOT NULL DEFAULT 0
        CHECK (available_balance_minor >= 0),
    reserved_balance_minor INTEGER NOT NULL DEFAULT 0
        CHECK (reserved_balance_minor >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id),
    UNIQUE (company_id, currency)
);

-- COMPANY WALLET TRANSACTIONS
CREATE TABLE IF NOT EXISTS company_wallet_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id INTEGER NOT NULL,
    company_id INTEGER NOT NULL,
    transaction_type TEXT NOT NULL CHECK (
        transaction_type IN (
            'deposit',
            'campaign_reserve',
            'campaign_release',
            'campaign_refund',
            'adjustment'
        )
    ),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    currency TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'confirmed', 'failed', 'reversed')
    ),
    payment_provider TEXT,
    provider_reference TEXT UNIQUE,
    idempotency_key TEXT UNIQUE,
    description TEXT,
    confirmed_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (wallet_id) REFERENCES company_wallets(id),
    FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- CAMPAIGNS CREATED BY APPROVED COMPANIES
CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    instructions TEXT NOT NULL,
    target_url TEXT,
    currency TEXT NOT NULL CHECK (
        length(currency) = 3
    ),
    total_budget_minor INTEGER NOT NULL CHECK (total_budget_minor > 0),
    reward_per_completion_minor INTEGER NOT NULL
        CHECK (reward_per_completion_minor > 0),
    max_completions INTEGER NOT NULL CHECK (max_completions > 0),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (
        status IN (
            'draft',
            'pending_review',
            'approved',
            'published',
            'paused',
            'completed',
            'rejected'
        )
    ),
    rejection_reason TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    starts_at TEXT,
    ends_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (company_id) REFERENCES companies(id),
    FOREIGN KEY (created_by) REFERENCES users(email)
);

-- USER CAMPAIGN PERFORMANCE SUBMISSIONS
CREATE TABLE IF NOT EXISTS campaign_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    user_email TEXT NOT NULL,
    evidence TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitted' CHECK (
        status IN ('submitted', 'under_review', 'approved', 'rejected')
    ),
    review_reason TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    submitted_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
    FOREIGN KEY (user_email) REFERENCES users(email),
    UNIQUE (campaign_id, user_email)
);

-- REWARDS EARNED BY USERS
CREATE TABLE IF NOT EXISTS campaign_rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL UNIQUE,
    campaign_id INTEGER NOT NULL,
    user_email TEXT NOT NULL,
    company_id INTEGER NOT NULL,
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    platform_commission_minor INTEGER NOT NULL DEFAULT 0
        CHECK (platform_commission_minor >= 0),
    currency TEXT NOT NULL CHECK (
        length(currency) = 3
    ),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'approved', 'credited', 'reversed')
    ),
    created_at TEXT NOT NULL,
    credited_at TEXT,
    FOREIGN KEY (submission_id) REFERENCES campaign_submissions(id),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
    FOREIGN KEY (user_email) REFERENCES users(email),
    FOREIGN KEY (company_id) REFERENCES companies(id)
);

-- USER WALLETS: one wallet per user and currency
CREATE TABLE IF NOT EXISTS user_wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_email TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (
        length(currency) = 3
    ),
    balance_minor INTEGER NOT NULL DEFAULT 0
        CHECK (balance_minor >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_email) REFERENCES users(email),
    UNIQUE (user_email, currency)
);

-- USER WALLET TRANSACTIONS
CREATE TABLE IF NOT EXISTS user_wallet_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet_id INTEGER NOT NULL,
    user_email TEXT NOT NULL,
    transaction_type TEXT NOT NULL CHECK (
        transaction_type IN ('campaign_reward', 'payout', 'reversal', 'adjustment')
    ),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    currency TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'confirmed', 'failed', 'reversed')
    ),
    reference TEXT UNIQUE,
    description TEXT,
    created_at TEXT NOT NULL,
    confirmed_at TEXT,
    FOREIGN KEY (wallet_id) REFERENCES user_wallets(id),
    FOREIGN KEY (user_email) REFERENCES users(email)
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_company_wallets_company
ON company_wallets(company_id);

CREATE INDEX IF NOT EXISTS idx_company_transactions_company
ON company_wallet_transactions(company_id, created_at);

CREATE INDEX IF NOT EXISTS idx_campaigns_company_status
ON campaigns(company_id, status);

CREATE INDEX IF NOT EXISTS idx_campaigns_status
ON campaigns(status, created_at);

CREATE INDEX IF NOT EXISTS idx_campaign_submissions_campaign
ON campaign_submissions(campaign_id, status);

CREATE INDEX IF NOT EXISTS idx_campaign_submissions_user
ON campaign_submissions(user_email);

CREATE INDEX IF NOT EXISTS idx_campaign_rewards_user
ON campaign_rewards(user_email, status);

CREATE INDEX IF NOT EXISTS idx_user_wallets_user
ON user_wallets(user_email);

CREATE INDEX IF NOT EXISTS idx_user_transactions_user
ON user_wallet_transactions(user_email, created_at);
