import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 获取用户使用情况
export async function getUserUsageInfo(userId) {
  const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', userId)
      .single();

  if (userError) {
    console.error('Error getting user info:', userError);
    return null;
  }

  const today = new Date().toISOString().split('T')[0];
  const { data: dailyUsage, error: dailyError } = await supabase
      .from('free_daily_usage')
      .select('usage_count')
      .eq('user_id', user.id)
      .eq('usage_date', today)
      .single();

  if (dailyError && dailyError.code !== 'PGRST116') {
    console.error('Error getting daily usage:', dailyError);
    return null;
  }

  return {
    user,
    dailyUsage: dailyUsage || { usage_count: 0 }
  };
}

// 生成用户使用情况消息
export async function generateUsageMessage(userId) {
  const usageInfo = await getUserUsageInfo(userId);
  if (!usageInfo) {
    return '获取信息失败，请稍后重试';
  }

  const { user, dailyUsage } = usageInfo;
  const remainingDays = user.subscription_expiry
      ? Math.ceil((new Date(user.subscription_expiry) - new Date()) / (1000 * 60 * 60 * 24))
      : 0;

  let message = '📊 您的使用情况：\n\n';

  if (user.subscription_status === 'paid') {
    message += `💎 订阅状态：已订阅\n`;
    message += `📅 剩余天数：${remainingDays}天\n`;
    message += `📝 剩余消息：${user.remaining_messages}条\n`;
  } else {
    message += `💎 订阅状态：免费用户\n`;
    message += `📝 今日已用：${dailyUsage.usage_count}/3条\n`;
    message += `📅 月度限额：${user.monthly_limit}条\n`;
  }

  message += '\n💡 提示：';
  if (user.subscription_status === 'paid') {
    message += '您已订阅，可以无限制使用服务';
  } else {
    message += '免费用户每日可使用3次，订阅后无限制使用';
  }

  return message;
}

// 生成订阅说明消息
export function generateSubscriptionInfo() {
//     return `💎 订阅服务说明：

// 1️⃣ 免费用户
// - 每日可使用3次
// - 月度限额2000条
// - 基础功能可用

// 2️⃣ 付费订阅
// - 无限次使用
// - 无月度限制
// - 所有功能可用

// 💰 订阅价格：
// - 月度订阅：$10/月
// - 季度订阅：$25/季
// - 年度订阅：$80/年

// 💳 充值方式：
// 1. 使用加密货币支付
// 2. 联系客服获取支付地址
// 3. 支付后24小时内开通服务

// 📞 客服支持：
// @Chainsmonitor_support

// 使用 /recharge 命令查看充值方式。`;
// }

  return `💎 订阅服务说明：

测试阶段可以免费使用哦`;
}

// 生成帮助说明消息
export function generateHelpMessage() {
  return `❓ 帮助说明：

🤖 我是Chainsmonitor，一个智能加密货币助手。

📝 我可以帮您：
- 分析加密货币市场
- 查询代币信息
- 监控钱包地址
- 提供投资建议

💡 使用提示：
1. 直接发送问题即可获得回答
2. 使用命令查看使用情况
3. 订阅后无限制使用

📊 使用限制：
- 免费用户每日3次
- 订阅用户无限制

💎 订阅服务：
- 使用 /subscription 查看订阅信息
- 选择适合的订阅方案
- 完成支付即可

命令列表：
/usage - 查看使用情况
/subscription - 订阅服务
/recharge - 充值订阅
/status - 订阅状态
/help - 帮助说明

如有问题，请联系客服：@Chainsmonitor_support`;
}