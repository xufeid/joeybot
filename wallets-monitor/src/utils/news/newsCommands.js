import { getLatestEnhancedNews, getEnhancedNewsByCoin, getEnhancedNewsByProject, getImportantEnhancedNews, formatEnhancedNewsForDisplay } from './newsStream.js';
import { sendUserMessage } from '../telegram.js';
const { supabase } = require('../supabase');
const { formatNewsForTelegram } = require('./newsPublisher');
const { sendTelegramMessage } = require('../telegram');

export async function handleNewsCommand(userId, command, args) {
  try {
    let news = [];
    let responseMessage = '';
    
    switch (command) {
      case 'latest':
        // 获取最新新闻
        news = await getLatestEnhancedNews(5);
        responseMessage = '📰 最新加密货币新闻';
        break;
        
      case 'coin':
        // 按代币获取新闻
        if (!args || args.length === 0) {
          return sendUserMessage('请指定代币符号，例如：/news coin BTC', userId);
        }
        const coinSymbol = args[0].toUpperCase();
        news = await getEnhancedNewsByCoin(coinSymbol, 5);
        responseMessage = `📰 关于 ${coinSymbol} 的最新新闻`;
        break;
        
      case 'project':
        // 按项目获取新闻
        if (!args || args.length === 0) {
          return sendUserMessage('请指定项目名称，例如：/news project Ethereum', userId);
        }
        const projectName = args.join(' ');
        news = await getEnhancedNewsByProject(projectName, 5);
        responseMessage = `📰 关于 ${projectName} 的最新新闻`;
        break;
        
      case 'important':
        // 获取重要新闻
        news = await getImportantEnhancedNews(7, 5);
        responseMessage = '📰 重要加密货币新闻';
        break;
        
      default:
        return sendUserMessage('未知的新闻命令。可用命令：latest, coin, project, important', userId);
    }
    
    if (news.length === 0) {
      return sendUserMessage('没有找到相关新闻。', userId);
    }
    
    // 发送新闻摘要
    await sendUserMessage(`${responseMessage}\n\n${formatNewsListForDisplay(news)}`, userId);
    
    // 询问用户是否需要查看详细内容
    await sendUserMessage('输入新闻ID查看详细内容，例如：/news view 123', userId);
    
  } catch (error) {
    console.error('Error handling news command:', error);
    await sendUserMessage('处理新闻命令时出错，请稍后再试。', userId);
  }
}

export async function handleViewNewsCommand(userId, newsId) {
  try {
    // 从数据库获取新闻详情
    const { data: news, error } = await supabase
      .from('news')
      .select('*')
      .eq('id', newsId)
      .eq('is_enhanced', true)
      .single();
      
    if (error || !news) {
      return sendUserMessage('未找到指定ID的新闻。', userId);
    }
    
    // 格式化新闻详情
    const formattedNews = formatNewsForTelegram(news);
    
    // 发送详细内容
    await sendUserMessage(formattedNews, userId);
    
  } catch (error) {
    console.error('Error handling view news command:', error);
    await sendUserMessage('查看新闻详情时出错，请稍后再试。', userId);
  }
}

// 格式化新闻列表用于显示
function formatNewsListForDisplay(newsList) {
  return newsList.map((news, index) => {
    const formattedNews = formatEnhancedNewsForDisplay(news);
    return `${index + 1}. <b>[ID: ${formattedNews.id}] ${formattedNews.title}</b>\n` +
           `   相关代币: ${formattedNews.coins.join(', ') || '无'}\n` +
           `   时间: ${new Date(formattedNews.timestamp * 1000).toLocaleString()}\n`;
  }).join('\n');
}