import { createClient } from '@supabase/supabase-js';
import OpenAI from "openai";
import dotenv from 'dotenv';
import { publishNewsToTelegram } from './newsPublisher.js';


dotenv.config();

// 创建 Supabase 客户端
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 创建 OpenAI 客户端
const openai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com/v1",
});

// 获取时间戳
function getTimeStamp() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

// 分析新闻内容 - 拆分为两个步骤
async function analyzeNewsContent(newsItem) {
  try {
    console.log(`[${getTimeStamp()}] 分析新闻 ID ${newsItem.id}: ${newsItem.news_title}`);
    
    // 第一步：理解新闻并提取关键词，同时获取Twitter内容
    const keywordsResult = await extractNewsKeywords(newsItem);
    if (!keywordsResult.success) {
      console.error(`[${getTimeStamp()}] 提取新闻关键词失败:`, keywordsResult.error);
      return false;
    }
    
    // 第二步：结合Twitter搜索结果生成增强内容
    const enhancedResult = await generateEnhancedContent(newsItem, keywordsResult.initialAnalysis, keywordsResult.tweets);
    if (!enhancedResult.success) {
      console.error(`[${getTimeStamp()}] 生成增强内容失败:`, enhancedResult.error);
      return false;
    }
    
    // 更新数据库中的新闻
    console.log(`[${getTimeStamp()}] 准备更新新闻 ID ${newsItem.id} 的分析结果...`);
    const { data, error } = await supabase
      .from('news')
      .update({
        coins_included: enhancedResult.data.coins_included || [],
        basic_tags: keywordsResult.initialAnalysis.basic_tags || [],
        entities: enhancedResult.data.entities || [],
        sentiment: enhancedResult.data.sentiment || 'neutral',
        importance_score: enhancedResult.data.importance_score || 5,
        summary: enhancedResult.data.summary || '',
        enhanced_title: enhancedResult.data.enhanced_title || newsItem.news_title,
        enhanced_content: enhancedResult.data.enhanced_content || '',
        context_knowledge: enhancedResult.data.context_knowledge || '',
        related_projects: enhancedResult.data.related_projects || [],
        related_events: enhancedResult.data.related_events || [],
        technical_explanation: enhancedResult.data.technical_explanation || '',
        market_impact: enhancedResult.data.market_impact || '',
        keywords: [
          ...(keywordsResult.initialAnalysis.search_strategy?.precise_keywords || []),
          ...(keywordsResult.initialAnalysis.search_strategy?.broad_keywords || [])
        ],
        insider_perspectives: enhancedResult.data.insider_perspectives || '',
        hidden_implications: enhancedResult.data.hidden_implications || '',
        is_analyzed: true,
        published: false,
        updated_at: new Date()
      })
      .eq('id', newsItem.id)
      .select();

    if (error) {
      console.error(`[${getTimeStamp()}] 更新新闻分析结果时出错:`, error);
      return false;
    }

    console.log(`[${getTimeStamp()}] 成功更新新闻 ID ${newsItem.id} 的分析结果:`, {
      is_analyzed: data[0]?.is_analyzed,
      published: data[0]?.published,
      updated_at: data[0]?.updated_at
    });

    // 直接调用发布接口
    console.log(`[${getTimeStamp()}] 准备发布新闻 ID ${newsItem.id}...`);
    const publishResult = await publishNewsToTelegram(data[0]);
    
    if (publishResult) {
      console.log(`[${getTimeStamp()}] 成功发布新闻 ID ${newsItem.id}`);
    } else {
      console.error(`[${getTimeStamp()}] 发布新闻 ID ${newsItem.id} 失败`);
    }

    return true;
  } catch (error) {
    console.error(`[${getTimeStamp()}] 分析新闻内容时出错:`, error);
    return false;
  }
}

// 第一步：提取新闻关键词和搜索策略
async function extractNewsKeywords(newsItem) {
  try {
    // 构建提示词
    const prompt = `请分析以下加密货币新闻，提取关键信息和搜索策略：

新闻标题：${newsItem.news_title}
新闻内容：${newsItem.news_content || '无详细内容'}
新闻链接：${newsItem.url || '无'}

请提供以下信息，并以JSON格式返回：
1. basic_tags: 新闻类型标签（可多选，最多3个）：
   - crypto_market: Crypto行情（如比特币价格突破）
   - exchange_news: 交易所动态（如上币、新功能）
   - breaking_news: 突发事件（如黑客攻击、政治事件）
   - project_updates: 项目信息（如新产品发布、代币TGE）
   - kol_opinions: KOL观点
   - market_reports: 市场报告
   - large_trades: 市场大额交易
   - chain_operations: 链上显著操作
   - 也可以根据新闻内容自行判断其他合适的标签
2. entities: 提取所有提到的实体（代币符号、项目名称、人名、组织等）
3. sentiment: 情感分析结果（positive, neutral, negative）
4. importance_score: 重要性评分（1-10，10为最重要）
5. summary: 20-30字的简短摘要
6. coins_included: 提取所有提到的加密货币代币符号，如BTC、ETH等
7. search_strategy: 搜索策略，包含：
   - precise_keywords: 用于精确搜索的1-3个关键词,（如"Justin Sun JST"）
   - broad_keywords: 用于广泛搜索的2-4个关键词（如"tron"）

8. search_timeframe: 建议的搜索时间范围（如"24h"或"7d"）

JSON格式示例：
{
  "basic_tags": ["crypto_market", "breaking_news"],
  "entities": ["JST", "Justin Sun", "Tron"],
  "sentiment": "neutral",
  "importance_score": 7,
  "summary": "Justin Sun宣布JST代币发行计划",
  "coins_included": ["JST", "TRX"],
  "search_strategy": {
    "precise_keywords": "Justin Sun JST",
    "broad_keywords": "Tron"
  },
  "search_timeframe": "24h"
}

请确保内容准确、客观，避免过度推测。`;

    const response = await openai.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: "You are a cryptocurrency news analyst that extracts key information and search strategies." },
        { role: "user", content: prompt }
      ],
      temperature: 0.4,
      max_tokens: 1000,
      response_format: { type: "json_object" }
    });

    console.log(`[${getTimeStamp()}] AI 分析结果:`, response.choices[0].message.content);

    const analysisResult = JSON.parse(response.choices[0].message.content);
    
    // 执行两次搜索
    const preciseTweets = await searchTwitter(
      analysisResult.search_strategy.precise_keywords,
      analysisResult.search_timeframe
    );
    
    // console.log(`[${getTimeStamp()}] 精确关键词搜索结果:`, {
    //   keywords: analysisResult.search_strategy.precise_keywords,
    //   results: preciseTweets.map(tweet => ({
    //     text: tweet.text,
    //     author: tweet.author.name,
    //     followers: tweet.author.followers_count,
    //     favorites: tweet.favorites,
    //     retweets: tweet.retweets
    //   }))
    // });
    
    // const broadTweets = await searchTwitter(
    //   analysisResult.search_strategy.broad_keywords,
    //   analysisResult.search_timeframe
    // );
    
    // console.log(`[${getTimeStamp()}] 广泛关键词搜索结果:`, {
    //   keywords: analysisResult.search_strategy.broad_keywords,
    //   results: broadTweets.map(tweet => ({
    //     text: tweet.text,
    //     author: tweet.author.name,
    //     followers: tweet.author.followers_count,
    //     favorites: tweet.favorites,
    //     retweets: tweet.retweets
    //   }))
    // });
    
    // 合并并去重推文
    // const allTweets = [...preciseTweets, ...broadTweets]
    //   .filter((tweet, index, self) => 
    //     index === self.findIndex(t => t.id === tweet.id)
    //   );
    
    // console.log(`[${getTimeStamp()}] 搜索策略执行结果:`, {
    //   precise_results: preciseTweets.length,
    //   broad_results: broadTweets.length,
    //   total_unique_results: allTweets.length,
    //   all_tweets: allTweets.map(tweet => ({
    //     text: tweet.text,
    //     author: tweet.author.name,
    //     followers: tweet.author.followers_count,
    //     favorites: tweet.favorites,
    //     retweets: tweet.retweets
    //   }))
    // });

    // 更新数据库中的部分内容
    console.log(`[${getTimeStamp()}] 准备更新新闻 ID ${newsItem.id} 的初步分析结果...`);
    console.log('即将写入 basic_tags：', analysisResult.basic_tags);
    const { data: initialData, error: initialError } = await supabase
      .from('news')
      .update({
        coins_included: analysisResult.coins_included || [],
        basic_tags: analysisResult.basic_tags || [],
        entities: analysisResult.entities || [],
        sentiment: analysisResult.sentiment || 'neutral',
        importance_score: analysisResult.importance_score || 5,
        summary: analysisResult.summary || '',
        keywords: [
          analysisResult.search_strategy?.precise_keywords || '',
          analysisResult.search_strategy?.broad_keywords || ''
        ],
        updated_at: new Date()
      })
      .eq('id', newsItem.id)
      .select();

    console.log('写入后返回 data.basic_tags：', data?.[0]?.basic_tags, 'error:', error);

    if (initialError) {
      console.error(`[${getTimeStamp()}] 更新新闻初步分析结果时出错:`, initialError);
      return {
        success: false,
        error: initialError.message
      };
    }

    console.log(`[${getTimeStamp()}] 成功更新新闻 ID ${newsItem.id} 的初步分析结果:`, {
      basic_tags: initialData[0]?.basic_tags,
      coins_included: initialData[0]?.coins_included,
      sentiment: initialData[0]?.sentiment
    });
    
    return {
      success: true,
      initialAnalysis: analysisResult,
      tweets: preciseTweets
    };
  } catch (error) {
    console.error(`[${getTimeStamp()}] 提取新闻关键词时出错:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

// 第二步：结合Twitter搜索结果生成增强内容
async function generateEnhancedContent(newsItem, initialAnalysis, tweets) {
  try {
    // 格式化推文数据，提取最有价值的评论
    const formattedTweets = tweets && tweets.length > 0 
      ? tweets.map((tweet, index) => {
          // 计算推文的影响力分数
          const impactScore = (tweet.favorites + tweet.retweets * 2 + tweet.replies * 3) * 
                            (tweet.author.followers_count > 10000 ? 1.5 : 1);
          return {
            text: tweet.text,
            author: `${tweet.author.name} (@${tweet.author.screen_name})`,
            followers: tweet.author.followers_count,
            impact: impactScore
          };
        })
        // 按影响力排序并只取前10条
        .sort((a, b) => b.impact - a.impact)
        .slice(0, 10)
      : [];
    
    // 构建新的提示词
    const prompt = `你是一个资深的中文加密货币评论员，以犀利、幽默、有洞察力的风格评论新闻。

新闻标题：${newsItem.news_title}
新闻内容：${newsItem.news_content || '无详细内容'}
新闻链接：${newsItem.url || '无'}

社区反应：
${formattedTweets.map((tweet, index) => `
推文 ${index + 1}:
${tweet.text}
作者：${tweet.author} | 粉丝：${tweet.followers}
---`).join('\n')}

请以JSON格式返回以下内容：
1. enhanced_content: 5-8句评论，要求：
   - 风格犀利、幽默、有洞察力
   - 结合社区情绪和反应
   - 包含对新闻背后动机的质疑或分析
   - 可以适当使用网络用语和梗
   - 避免过于正式或学术化的表达
2. sentiment: 整体情绪（positive/neutral/negative）
3. importance_score: 重要性（1-10）
4. coins_included: 相关代币符号

注意：
- 评论要像是一个资深的crypto社区成员写的
- 可以适当使用讽刺、幽默的语气
- 要能引起读者的共鸣和兴趣
- 避免过于温和或模棱两可的表达`;

    const response = await openai.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: "You are a sharp, witty, and insightful cryptocurrency commentator who writes engaging and thought-provoking comments." },
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 2000,
      response_format: { type: "json_object" }
    });

    const enhancedResult = JSON.parse(response.choices[0].message.content);
    
    return {
      success: true,
      data: enhancedResult
    };
  } catch (error) {
    console.error(`[${getTimeStamp()}] 生成增强内容时出错:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

// 导入Twitter搜索函数
import { searchTwitter } from '../tweetApi.js';

// 获取未分析的新闻
async function getUnanalyzedNews(limit = 5) {
  try {
    const { data, error } = await supabase
      .from('news')
      .select('*')
      .eq('is_analyzed', false)
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (error) {
      console.error(`[${getTimeStamp()}] 获取未分析新闻时出错:`, error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error(`[${getTimeStamp()}] 获取未分析新闻时异常:`, error);
    return [];
  }
}

// 处理未分析的新闻
async function processUnanalyzedNews() {
  const unanalyzedNews = await getUnanalyzedNews(5);
  
  if (unanalyzedNews.length === 0) {
    console.log(`[${getTimeStamp()}] 没有找到未分析的新闻。`);
    return;
  }
  
  console.log(`[${getTimeStamp()}] 找到 ${unanalyzedNews.length} 条未分析的新闻。`);
  
  for (const newsItem of unanalyzedNews) {
    await analyzeNewsContent(newsItem);
    // 添加短暂延迟，避免API限制
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

// 设置实时监听新新闻
function setupNewNewsListener() {
  const channel = supabase
    .channel('new_news_insert')  // 改为更准确的名称
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'news',
        filter: 'is_analyzed=eq.false'
      },
      async (payload) => {
        console.log(`[${getTimeStamp()}] 检测到新新闻:`, {
          id: payload.new.id,
          title: payload.new.news_title
        });
        await analyzeNewsContent(payload.new);
      }
    )
    .subscribe((status) => {
      console.log(`[${getTimeStamp()}] 新新闻监听器状态:`, status);
    });
    
  return channel;
}

// 启动新闻增强器
export function startNewsEnhancer() {
  console.log(`[${getTimeStamp()}] 启动新闻增强器...`);
  
  // 设置实时监听
  const channel = setupNewNewsListener();
  
  // 立即处理一次现有的未分析新闻
  processUnanalyzedNews();
  
  // 每5分钟检查一次未分析的新闻（作为备份机制）
  const interval = setInterval(processUnanalyzedNews, 5 * 60 * 1000);
  
  return {
    channel,
    interval,
    stop: () => {
      channel.unsubscribe();
      clearInterval(interval);
      console.log(`[${getTimeStamp()}] 新闻增强器已停止`);
    }
  };
}

// 在应用启动时调用此函数
export default startNewsEnhancer;