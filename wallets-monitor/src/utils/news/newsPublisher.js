import { createClient } from '@supabase/supabase-js';
import { sendTelegramMessage } from '../telegram.js';
import dotenv from 'dotenv';

dotenv.config();

// 创建 Supabase 客户端
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 目标频道 ID
const TARGET_CHANNEL_ID = -1002563459042;

// 获取时间戳
function getTimeStamp() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

// 格式化新闻为Telegram消息
export function formatNewsForTelegram(newsItem) {
  const timestamp = new Date(newsItem.timestamp * 1000).toLocaleString();
  const coins = newsItem.coins_included && newsItem.coins_included.length > 0 
    ? newsItem.coins_included.join(', ') 
    : '无';
  
  // 新闻类型标签映射
  const newsTypeLabels = {
    crypto_market: '📈 行情',
    exchange_news: '🏦 交易所',
    breaking_news: '🚨 突发',
    project_updates: '📢 项目',
    kol_opinions: '👤 KOL',
    market_reports: '📊 报告',
    large_trades: '💰 大额',
    chain_operations: '⛓️ 链上'
  };
  
  // 生成类型标签字符串
  const typeTags = newsItem.basic_tags && newsItem.basic_tags.length > 0
    ? newsItem.basic_tags.map(type => newsTypeLabels[type] || type).join(' | ')
    : '无';
  
  let message = `<b>📰 ${typeTags} | ${newsItem.enhanced_title || newsItem.news_title}</b>\n\n`;
  message += `${newsItem.news_content || ''}\n\n`;
  
  if (newsItem.context_knowledge) {
    message += `<b>📚 背景知识:</b>\n${newsItem.context_knowledge}\n\n`;
  }
  
  if (newsItem.technical_explanation) {
    message += `<b>🔧 技术解释:</b>\n${newsItem.technical_explanation}\n\n`;
  }
  
  if (newsItem.market_impact) {
    message += `<b>📊 市场影响:</b>\n${newsItem.market_impact}\n\n`;
  }
  
  if (newsItem.related_projects && newsItem.related_projects.length > 0) {
    message += `<b>🔗 相关项目:</b> ${newsItem.related_projects.join(', ')}\n`;
  }
  
  if (newsItem.related_events && newsItem.related_events.length > 0) {
    message += `<b>📅 相关事件:</b> ${newsItem.related_events.join(', ')}\n`;
  }
  
  message += `\n<b>🏷️ 类型:</b> ${typeTags}\n`;
  message += `<b>🪙 相关代币:</b> ${coins}\n`;
  message += `<b>🕒 时间:</b> ${timestamp}\n`;
  message += `<b>📡 来源:</b> ${newsItem.source_name}\n`;
  
  if (newsItem.url) {
    message += `\n<a href="${newsItem.url}">查看原文</a>`;
  }
  
  return message;
}

// 设置实时监听已分析的新闻
function setupEnhancedNewsListener() {
  console.log(`[${getTimeStamp()}] 设置增强新闻实时监听器...`);
  
  const subscription = supabase
    .channel('news-updates')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'news',
        filter: 'is_analyzed=eq.true'
      },
      async (payload) => {
        try {
          console.log(`[${getTimeStamp()}] 收到新闻更新事件:`, {
            id: payload.new.id,
            is_analyzed: payload.new.is_analyzed,
            published: payload.new.published,
            old_is_analyzed: payload.old?.is_analyzed,
            old_published: payload.old?.published
          });

          // 检查新闻是否已经发布
          if (payload.new.published) {
            console.log(`[${getTimeStamp()}] 新闻 ID ${payload.new.id} 已经发布，跳过处理`);
            return;
          }

          // 确保新闻已经被分析
          if (!payload.new.is_analyzed) {
            console.log(`[${getTimeStamp()}] 新闻 ID ${payload.new.id} 尚未分析完成，跳过处理`);
            return;
          }

          console.log(`[${getTimeStamp()}] 准备发布新闻 ID ${payload.new.id}...`);
          await publishNewsToTelegram(payload.new);
          
          // 更新新闻的发布状态
          const { error } = await supabase
            .from('news')
            .update({ published: true })
            .eq('id', payload.new.id);

          if (error) {
            console.error(`[${getTimeStamp()}] 更新新闻发布状态时出错:`, error);
            return;
          }

          console.log(`[${getTimeStamp()}] 成功发布并更新新闻 ID ${payload.new.id} 的状态`);
        } catch (error) {
          console.error(`[${getTimeStamp()}] 处理新闻更新事件时出错:`, error);
        }
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`[${getTimeStamp()}] 增强新闻实时监听器已成功订阅`);
      } else {
        console.error(`[${getTimeStamp()}] 增强新闻实时监听器订阅失败，状态:`, status);
      }
    });

  return subscription;
}

// 发布新闻到Telegram
export async function publishNewsToTelegram(newsItem) {
  try {
    // 验证新闻数据
    if (!newsItem || !newsItem.id) {
      console.error(`[${getTimeStamp()}] 无效的新闻数据`);
      return false;
    }

    // 检查新闻是否已经发布
    if (newsItem.published) {
      console.log(`[${getTimeStamp()}] 新闻 ID ${newsItem.id} 已经发布，跳过处理`);
      return true;
    }

    // 检查新闻是否已经分析
    if (!newsItem.is_analyzed) {
      console.error(`[${getTimeStamp()}] 新闻 ID ${newsItem.id} 尚未分析完成，无法发布`);
      return false;
    }

    // 格式化新闻内容
    const message = formatNewsForTelegram(newsItem);
    if (!message) {
      console.error(`[${getTimeStamp()}] 新闻 ID ${newsItem.id} 格式化失败`);
      return false;
    }

    // 发送到Telegram
    console.log(`[${getTimeStamp()}] 正在发送新闻 ID ${newsItem.id} 到Telegram...`);
    const response = await sendTelegramMessage(message, null, TARGET_CHANNEL_ID);
    
    if (!response || !response.ok) {
      console.error(`[${getTimeStamp()}] 发送新闻到Telegram失败:`, response?.error || '未知错误');
      return false;
    }

    // 更新数据库中的发布状态
    const { error } = await supabase
      .from('news')
      .update({ published: true, updated_at: new Date() })
      .eq('id', newsItem.id);

    if (error) {
      console.error(`[${getTimeStamp()}] 更新新闻发布状态时出错:`, error);
      return false;
    }

    console.log(`[${getTimeStamp()}] 成功发布新闻 ID ${newsItem.id}`);
    return true;
  } catch (error) {
    console.error(`[${getTimeStamp()}] 发布新闻时出错:`, error);
    return false;
  }
}

// 获取已分析但未发布的新闻
async function getAnalyzedUnpublishedNews(limit = 5) {
  try {
    const { data, error } = await supabase
      .from('news')
      .select('*')
      .eq('is_analyzed', true)
      .eq('published', false)
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (error) {
      console.error(`[${getTimeStamp()}] 获取已分析未发布新闻时出错:`, error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error(`[${getTimeStamp()}] 获取已分析未发布新闻时异常:`, error);
    return [];
  }
}

// 处理已分析但未发布的新闻
async function processAnalyzedUnpublishedNews() {
  const unpublishedNews = await getAnalyzedUnpublishedNews(5);
  
  if (unpublishedNews.length === 0) {
    console.log(`[${getTimeStamp()}] 没有找到已分析未发布的新闻。`);
    return;
  }
  
  console.log(`[${getTimeStamp()}] 找到 ${unpublishedNews.length} 条已分析未发布的新闻。`);
  
  for (const newsItem of unpublishedNews) {
    await publishNewsToTelegram(newsItem);
    // 添加短暂延迟，避免消息发送过快
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

// 测试 Supabase 实时监听功能
async function testRealtimeConnection() {
  try {
    console.log(`[${getTimeStamp()}] 测试 Supabase 实时连接...`);
    
    // 创建一个测试通道
    const testChannel = supabase
      .channel('test_channel')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'news'
        },
        (payload) => {
          console.log(`[${getTimeStamp()}] 测试通道收到事件:`, payload);
        }
      )
      .subscribe((status) => {
        console.log(`[${getTimeStamp()}] 测试通道状态:`, status);
      });
      
    // 等待一段时间后取消订阅
    setTimeout(() => {
      testChannel.unsubscribe();
      console.log(`[${getTimeStamp()}] 测试通道已取消订阅`);
    }, 5000);
    
  } catch (error) {
    console.error(`[${getTimeStamp()}] 测试 Supabase 实时连接时出错:`, error);
  }
}

// 启动新闻发布器
export function startNewsPublisher() {
  console.log(`[${getTimeStamp()}] 启动新闻发布器...`);
  
  // 立即处理一次现有的未发布新闻
  processAnalyzedUnpublishedNews();
  
  // 每10分钟检查一次未发布的新闻（作为备份机制）
  const interval = setInterval(processAnalyzedUnpublishedNews, 10 * 60 * 1000);
  
  return {
    interval,
    stop: () => {
      clearInterval(interval);
      console.log(`[${getTimeStamp()}] 新闻发布器已停止`);
    }
  };
}

// 在应用启动时调用此函数
export default startNewsPublisher;