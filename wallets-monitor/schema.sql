-- 删除旧表（如果存在）
DROP TABLE IF EXISTS user_usage_logs CASCADE;
DROP TABLE IF EXISTS user_sessions CASCADE;
DROP TABLE IF EXISTS free_daily_usage CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS txs CASCADE;
DROP TABLE IF EXISTS wallets CASCADE;

-- 创建用户表
CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    subscription_status TEXT NOT NULL DEFAULT 'free',
    subscription_expiry TIMESTAMP WITH TIME ZONE,
    monthly_limit INTEGER NOT NULL DEFAULT 2000,
    remaining_messages INTEGER NOT NULL DEFAULT 2000,
    last_reset_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 创建用户会话表
CREATE TABLE user_sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    session_id TEXT NOT NULL,
    context JSONB NOT NULL DEFAULT '{}',
    last_activity TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, session_id)
);

-- 创建用户使用日志表
CREATE TABLE user_usage_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 创建免费用户每日使用记录表
CREATE TABLE free_daily_usage (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    usage_date DATE NOT NULL,
    usage_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, usage_date)
);

-- 创建钱包表
CREATE TABLE wallets (
    id BIGSERIAL PRIMARY KEY,
    address TEXT NOT NULL UNIQUE,
    chain TEXT NOT NULL,
    name TEXT,
    description TEXT,
    tags TEXT[],
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 创建交易表
CREATE TABLE txs (
    id BIGSERIAL PRIMARY KEY,
    tx_hash TEXT NOT NULL UNIQUE,
    wallet_id BIGINT NOT NULL REFERENCES wallets(id),
    chain TEXT NOT NULL,
    block_number BIGINT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    token_address TEXT,
    token_symbol TEXT,
    amount DECIMAL(78,18),
    usd_value DECIMAL(20,2),
    score DECIMAL(10,2) NOT NULL DEFAULT 0,
    analysis JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 创建索引
CREATE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_users_subscription_status ON users(subscription_status);
CREATE INDEX idx_users_subscription_expiry ON users(subscription_expiry);
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_last_activity ON user_sessions(last_activity);
CREATE INDEX idx_user_usage_logs_user_id ON user_usage_logs(user_id);
CREATE INDEX idx_user_usage_logs_created_at ON user_usage_logs(created_at);
CREATE INDEX idx_free_daily_usage_user_id ON free_daily_usage(user_id);
CREATE INDEX idx_free_daily_usage_usage_date ON free_daily_usage(usage_date);
CREATE INDEX idx_wallets_address ON wallets(address);
CREATE INDEX idx_wallets_chain ON wallets(chain);
CREATE INDEX idx_txs_tx_hash ON txs(tx_hash);
CREATE INDEX idx_txs_wallet_id ON txs(wallet_id);
CREATE INDEX idx_txs_chain ON txs(chain);
CREATE INDEX idx_txs_timestamp ON txs(timestamp);
CREATE INDEX idx_txs_score ON txs(score);

-- 创建更新时间的触发器函数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 为所有表添加更新时间触发器
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_sessions_updated_at
    BEFORE UPDATE ON user_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_free_daily_usage_updated_at
    BEFORE UPDATE ON free_daily_usage
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_wallets_updated_at
    BEFORE UPDATE ON wallets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_txs_updated_at
    BEFORE UPDATE ON txs
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 创建用户使用限制相关函数
CREATE OR REPLACE FUNCTION decrement_remaining_messages()
RETURNS INTEGER AS $$
BEGIN
    RETURN GREATEST(remaining_messages - 1, 0);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_daily_usage()
RETURNS INTEGER AS $$
BEGIN
    RETURN usage_count + 1;
END;
$$ LANGUAGE plpgsql;