import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 获取时间戳
function getTimeStamp() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

// 检查并重置月度使用限制
async function checkAndResetMonthlyLimit(user) {
  const today = new Date();
  const lastResetDate = user.last_reset_date ? new Date(user.last_reset_date) : null;

  // 如果上次重置日期不存在或是上个月，重置使用限制
  if (!lastResetDate || lastResetDate.getMonth() !== today.getMonth() || lastResetDate.getFullYear() !== today.getFullYear()) {
    const { error } = await supabase
        .from('users')
        .update({
          remaining_messages: user.monthly_limit,
          last_reset_date: today
        })
        .eq('id', user.id);

    if (error) {
      console.error('Error resetting monthly limit:', error);
      return false;
    }
    return true;
  }
  return false;
}

// 检查用户使用限制
export async function checkUserUsageLimit(userId, isGreeting = false, username = null, firstName = null, lastName = null) {
  // 确保 userId 是数字类型
  const telegramId = Number(userId);
  if (isNaN(telegramId)) {
    console.error('Invalid telegram_id:', userId);
    return { canUse: false, message: '无效的用户ID' };
  }

  console.log(`[${getTimeStamp()}] Checking usage limit for user: ${telegramId}`);

  const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 is "not found" error
    console.error('Error checking user usage:', error);
    return { canUse: false, message: '系统错误，请稍后重试' };
  }

  if (!user) {
    console.log(`[${getTimeStamp()}] Creating new user: ${telegramId}`);
    // 用户不存在，创建新用户
    const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert([
          {
            telegram_id: telegramId,
            username: username,
            first_name: firstName,
            last_name: lastName,
            subscription_status: 'free',
            monthly_limit: 2000,
            remaining_messages: 2000,
            last_reset_date: new Date().toISOString(),
            created_at: new Date().toISOString()
          }
        ])
        .select()
        .single();

    if (createError) {
      console.error('Error creating new user:', createError);
      return { canUse: false, message: '系统错误，请稍后重试' };
    }

    console.log(`[${getTimeStamp()}] New user created:`, newUser);

    // 创建每日使用记录
    const today = new Date().toISOString().split('T')[0];
    const { error: dailyError } = await supabase
        .from('free_daily_usage')
        .insert([
          {
            user_id: newUser.id,
            usage_date: today,
            usage_count: 0
          }
        ]);

    if (dailyError) {
      console.error('Error creating daily usage record:', dailyError);
    }

    return { canUse: true, user: newUser, isNewUser: true };
  }

  // 如果用户已存在，更新用户名和显示名称（如果提供了新值）
  if (username || firstName || lastName) {
    const updateData = {};
    if (username) updateData.username = username;
    if (firstName) updateData.first_name = firstName;
    if (lastName) updateData.last_name = lastName;
    updateData.updated_at = new Date().toISOString();

    const { error: updateError } = await supabase
        .from('users')
        .update(updateData)
        .eq('telegram_id', telegramId);

    if (updateError) {
      console.error('Error updating user info:', updateError);
    }
  }

  console.log(`[${getTimeStamp()}] Found existing user:`, user);

  // 检查并重置月度使用限制
  await checkAndResetMonthlyLimit(user);

  // 如果是问候语，不检查使用限制
  if (isGreeting) {
    return { canUse: true, user };
  }

  // 检查订阅状态
  if (user.subscription_status === 'paid') {
    if (user.subscription_expiry && new Date(user.subscription_expiry) < new Date()) {
      // 订阅已过期，更新状态为免费
      await supabase
          .from('users')
          .update({ subscription_status: 'free' })
          .eq('telegram_id', telegramId);
      return { canUse: false, message: '您的订阅已过期，请续费' };
    }

    // 检查剩余消息数
    if (user.remaining_messages <= 0) {
      return { canUse: false, message: '您的月度使用次数已用完，请续费' };
    }

    return { canUse: true, user };
  }

  // 免费用户检查每日使用限制
  const today = new Date().toISOString().split('T')[0];
  const { data: dailyUsage, error: dailyError } = await supabase
      .from('free_daily_usage')
      .select('*')
      .eq('user_id', user.id)
      .eq('usage_date', today)
      .single();

  if (dailyError && dailyError.code !== 'PGRST116') {
    console.error('Error checking daily usage:', dailyError);
    return { canUse: false, message: '系统错误，请稍后重试' };
  }

  if (!dailyUsage) {
    // 创建新的每日使用记录
    const { error: createDailyError } = await supabase
        .from('free_daily_usage')
        .insert([
          {
            user_id: user.id,
            usage_date: today,
            usage_count: 0
          }
        ]);

    if (createDailyError) {
      console.error('Error creating daily usage record:', createDailyError);
      return { canUse: false, message: '系统错误，请稍后重试' };
    }
    return { canUse: true, user };
  }

  // 检查每日使用次数
  if (dailyUsage.usage_count >= 3) {
    return { canUse: false, message: '您今日的免费使用次数已用完，请订阅以获得更多使用次数' };
  }

  return { canUse: true, user };
}

// 更新用户使用次数
export async function updateUserUsage(userId, isGreeting = false) {
  // 如果是问候语，不更新使用次数
  if (isGreeting) {
    return;
  }

  const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', userId)
      .single();

  if (userError) {
    console.error('Error getting user:', userError);
    return;
  }

  if (user.subscription_status === 'paid') {
    // 更新付费用户剩余消息数
    const { data, error } = await supabase.rpc('decrement_remaining_messages', {
      user_id: user.id
    });

    if (error) {
      console.error('Error updating remaining messages:', error);
    }
  } else {
    // 更新免费用户每日使用次数
    const today = new Date().toISOString().split('T')[0];

    // 先获取当前使用次数
    const { data: dailyUsage, error: getError } = await supabase
        .from('free_daily_usage')
        .select('usage_count')
        .eq('user_id', user.id)
        .eq('usage_date', today)
        .single();

    if (getError) {
      console.error('Error getting daily usage:', getError);
      return;
    }

    // 更新使用次数
    const { error: updateError } = await supabase
        .from('free_daily_usage')
        .update({
          usage_count: (dailyUsage?.usage_count || 0) + 1,
          updated_at: new Date()
        })
        .eq('user_id', user.id)
        .eq('usage_date', today);

    if (updateError) {
      console.error('Error updating daily usage:', updateError);
    }
  }
}

// 记录用户使用日志
export async function logUserUsage(userId, question, answer, tokensUsed) {
  try {
    // 确保 userId 是数字类型
    const numericUserId = Number(userId);
    if (isNaN(numericUserId)) {
      console.error('Invalid userId:', userId);
      return;
    }

    // 先获取用户ID
    const { data: user, error: userError } = await supabase
        .from('users')
        .select('id')
        .eq('telegram_id', numericUserId)
        .single();

    if (userError) {
      console.error('Error getting user:', userError);
      return;
    }

    // 记录使用日志
    const { error } = await supabase
        .from('user_usage_logs')
        .insert([
          {
            user_id: user.id,
            question: question,
            answer: answer,
            tokens_used: tokensUsed
          }
        ]);

    if (error) {
      console.error('Error logging user usage:', error);
    }
  } catch (error) {
    console.error('Error in logUserUsage:', error);
  }
}

// 存储用户会话状态
const userSessions = new Map();
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30分钟超时

// 清理过期的会话
export function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [userId, session] of userSessions.entries()) {
    if (now - session.lastActive > SESSION_TIMEOUT) {
      userSessions.delete(userId);
      console.log(`[${getTimeStamp()}] Session expired for user ${userId}`);
    }
  }
}

// 获取或创建用户会话
export function getOrCreateUserSession(userId) {
  cleanupExpiredSessions(); // 清理过期会话

  let session = userSessions.get(userId);
  if (!session) {
    session = {
      context: [],
      lastActive: Date.now()
    };
    userSessions.set(userId, session);
  } else {
    session.lastActive = Date.now(); // 更新最后活动时间
  }
  return session;
}

// 更新用户会话上下文
export function updateUserSessionContext(userId, context) {
  const session = getOrCreateUserSession(userId);
  session.context = context;
  session.lastActive = Date.now(); // 更新最后活动时间
}

// 确保用户存在，如果不存在则创建
export async function ensureUserExists(userId, username = null, firstName = null, lastName = null) {
  try {
    // 首先尝试获取用户
    const { data: existingUser, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('telegram_id', userId)
        .single();

    if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 表示没有找到记录
      console.error(`[${getTimeStamp()}] Error fetching user:`, fetchError);
      throw fetchError;
    }

    // 如果用户不存在，创建新用户
    if (!existingUser) {
      const { data: newUser, error: insertError } = await supabase
          .from('users')
          .insert([
            {
              telegram_id: userId,
              username: username,
              first_name: firstName,
              last_name: lastName,
              subscription_status: 'free',
              monthly_limit: 2000,
              remaining_messages: 2000,
              last_reset_date: new Date().toISOString(),
              created_at: new Date().toISOString()
            }
          ])
          .select()
          .single();

      if (insertError) {
        console.error(`[${getTimeStamp()}] Error creating user:`, insertError);
        throw insertError;
      }

      console.log(`[${getTimeStamp()}] New user created:`, newUser);
      return newUser;
    }

    // 如果用户存在，更新用户信息（如果有变化）
    if (existingUser.username !== username ||
        existingUser.first_name !== firstName ||
        existingUser.last_name !== lastName) {
      const { data: updatedUser, error: updateError } = await supabase
          .from('users')
          .update({
            username: username,
            first_name: firstName,
            last_name: lastName,
            updated_at: new Date().toISOString()
          })
          .eq('telegram_id', userId)
          .select()
          .single();

      if (updateError) {
        console.error(`[${getTimeStamp()}] Error updating user:`, updateError);
        throw updateError;
      }

      console.log(`[${getTimeStamp()}] User info updated:`, updatedUser);
      return updatedUser;
    }

    return existingUser;
  } catch (error) {
    console.error(`[${getTimeStamp()}] Error in ensureUserExists:`, error);
    throw error;
  }
} 