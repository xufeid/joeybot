-- 删除旧表（如果存在）
DROP TABLE IF EXISTS user_usage_logs CASCADE;
DROP TABLE IF EXISTS free_daily_usage CASCADE;
DROP TABLE IF EXISTS user_sessions CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- 删除旧函数（如果存在）
DROP FUNCTION IF EXISTS increment_usage_count() CASCADE;
DROP FUNCTION IF EXISTS decrement_remaining_messages() CASCADE;
DROP FUNCTION IF EXISTS increment_daily_usage() CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

-- 创建用户表
CREATE TABLE users (
  id bigint primary key generated always as identity,
  telegram_id text unique not null,           -- Telegram 用户ID
  username text,                              -- Telegram 用户名
  first_name text,                            -- 用户名字
  last_name text,                             -- 用户姓氏
  subscription_status text default 'free',    -- 订阅状态: free/paid
  subscription_expiry timestamptz,            -- 订阅到期时间
  monthly_limit integer default 2000,         -- 月度使用限制
  remaining_messages integer default 2000,    -- 剩余可用条数
  last_reset_date date,                       -- 上次重置日期
  created_at timestamptz default now(),       -- 记录创建时间
  updated_at timestamptz default now()        -- 记录更新时间
);

-- 创建用户会话表
CREATE TABLE user_sessions (
  id bigint primary key generated always as identity,
  user_id bigint references users(id),        -- 关联用户ID
  session_id text not null,                   -- 会话ID
  context jsonb,                              -- 会话上下文
  last_activity timestamptz default now(),    -- 最后活动时间
  created_at timestamptz default now(),       -- 创建时间
  updated_at timestamptz default now()        -- 更新时间
);

-- 创建用户使用记录表
CREATE TABLE user_usage_logs (
  id bigint primary key generated always as identity,
  user_id bigint references users(id),        -- 关联用户ID
  question text not null,                     -- 用户问题
  answer text,                                -- AI回答
  tokens_used integer,                        -- 使用的token数量
  created_at timestamptz default now()        -- 创建时间
);

-- 创建每日免费使用记录表
CREATE TABLE free_daily_usage (
  id bigint primary key generated always as identity,
  user_id bigint references users(id),        -- 关联用户ID
  usage_date date not null,                   -- 使用日期
  usage_count integer default 0,              -- 当日使用次数
  created_at timestamptz default now(),       -- 创建时间
  updated_at timestamptz default now(),       -- 更新时间
  UNIQUE(user_id, usage_date)                 -- 确保每个用户每天只有一条记录
);

-- 创建增加使用次数的函数
CREATE OR REPLACE FUNCTION increment_usage_count()
RETURNS integer AS $$
BEGIN
  RETURN usage_count + 1;
END;
$$ LANGUAGE plpgsql;

-- 创建更新剩余消息数的函数
CREATE OR REPLACE FUNCTION decrement_remaining_messages()
RETURNS integer AS $$
BEGIN
  RETURN remaining_messages - 1;
END;
$$ LANGUAGE plpgsql;

-- 创建更新每日使用次数的函数
CREATE OR REPLACE FUNCTION increment_daily_usage()
RETURNS integer AS $$
BEGIN
  RETURN usage_count + 1;
END;
$$ LANGUAGE plpgsql;

-- 创建更新时间的触发器函数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 为用户表添加更新时间触发器
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 为每日使用记录表添加更新时间触发器
CREATE TRIGGER update_free_daily_usage_updated_at
  BEFORE UPDATE ON free_daily_usage
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 为会话表添加更新时间触发器
CREATE TRIGGER update_user_sessions_updated_at
  BEFORE UPDATE ON user_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 添加索引
CREATE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_users_subscription_status ON users(subscription_status);
CREATE INDEX idx_users_subscription_expiry ON users(subscription_expiry);
CREATE INDEX idx_users_last_reset_date ON users(last_reset_date);
CREATE INDEX idx_free_daily_usage_user_date ON free_daily_usage(user_id, usage_date);
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_session_id ON user_sessions(session_id);
CREATE INDEX idx_user_usage_logs_user_id ON user_usage_logs(user_id);
CREATE INDEX idx_user_usage_logs_created_at ON user_usage_logs(created_at);

-- 创建聪明钱钱包表
CREATE TABLE wallets (
  id serial primary key,
  address text unique not null,               -- 钱包地址
  name text,                                  -- 钱包名称
  created_at timestamptz default now()        -- 记录创建时间
);

-- 创建交易记录表
CREATE TABLE txs (
  id bigint primary key generated always as identity,
  account text not null,                      -- Solana 钱包地址
  token_in_address text not null,             -- 输入代币的合约地址
  token_in_amount numeric not null,           -- 输入代币数量
  token_out_address text not null,            -- 输出代币的合约地址
  token_out_amount numeric not null,          -- 输出代币数量
  timestamp bigint not null,                  -- Unix 时间戳
  signature text not null,                    -- 交易签名
  description text,                           -- 交易描述
  created_at timestamptz default now()        -- 记录创建时间
);

-- 为钱包和交易表添加索引
CREATE INDEX idx_wallets_address ON wallets(address);
CREATE INDEX idx_txs_account ON txs(account);
CREATE INDEX idx_txs_timestamp ON txs(timestamp);