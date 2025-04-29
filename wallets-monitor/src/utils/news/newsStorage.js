import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// 创建 Supabase 客户端
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// 获取时间戳
function getTimeStamp() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

// 存储新闻到数据库
export async function storeNewsToDatabase(newsData) {
  try {
    // 检查必要字段
    if (!newsData.news_title) {
      console.error(`[${getTimeStamp()}] 存储新闻失败: 缺少标题`);
      return null;
    }

    // 准备数据
    const newsItem = {
      source_name: newsData.source_name || '未知来源',
      news_title: newsData.news_title,
      news_content: newsData.news_content || null,
      url: newsData.url || null,
      timestamp: newsData.timestamp || Math.floor(Date.now() / 1000),
      is_analyzed: false,
      published: false
    };

    // 存储到数据库
    const { data, error } = await supabase
      .from('news')
      .insert([newsItem])
      .select();

    if (error) {
      console.error(`[${getTimeStamp()}] 存储新闻时出错:`, error);
      return null;
    }

    console.log(`[${getTimeStamp()}] 成功存储新闻: ${newsData.news_title}`);
    return data[0];
  } catch (error) {
    console.error(`[${getTimeStamp()}] 存储新闻时异常:`, error);
    return null;
  }
}

// 检查新闻是否已存在
export async function isNewsDuplicate(newsTitle, sourceUrl = null) {
  try {
    let query = supabase
      .from('news')
      .select('id')
      .eq('news_title', newsTitle)
      .limit(1);
    
    // 如果有URL，也按URL检查
    if (sourceUrl) {
      query = query.or(`url.eq.${sourceUrl}`);
    }

    const { data, error } = await query;

    if (error) {
      console.error(`[${getTimeStamp()}] 检查重复新闻时出错:`, error);
      return false; // 出错时假设不是重复的
    }

    return data && data.length > 0;
  } catch (error) {
    console.error(`[${getTimeStamp()}] 检查重复新闻时异常:`, error);
    return false;
  }
}

// 获取最新新闻
export async function getLatestNews(limit = 10) {
  try {
    const { data, error } = await supabase
      .from('news')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (error) {
      console.error(`[${getTimeStamp()}] 获取最新新闻时出错:`, error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error(`[${getTimeStamp()}] 获取最新新闻时异常:`, error);
    return [];
  }
}

// 按代币获取新闻
export async function getNewsByCoin(coinSymbol, limit = 10) {
  try {
    const { data, error } = await supabase
      .from('news')
      .select('*')
      .contains('coins_included', [coinSymbol.toUpperCase()])
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (error) {
      console.error(`[${getTimeStamp()}] 按代币获取新闻时出错:`, error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error(`[${getTimeStamp()}] 按代币获取新闻时异常:`, error);
    return [];
  }
}

// 按标签获取新闻
export async function getNewsByTag(tag, limit = 10) {
  try {
    const { data, error } = await supabase
      .from('news')
      .select('*')
      .contains('basic_tags', [tag])
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (error) {
      console.error(`[${getTimeStamp()}] 按标签获取新闻时出错:`, error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error(`[${getTimeStamp()}] 按标签获取新闻时异常:`, error);
    return [];
  }
}

// 获取重要新闻
export async function getImportantNews(minScore = 7, limit = 10) {
  try {
    const { data, error } = await supabase
      .from('news')
      .select('*')
      .gte('importance_score', minScore)
      .order('importance_score', { ascending: false })
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (error) {
      console.error(`[${getTimeStamp()}] 获取重要新闻时出错:`, error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error(`[${getTimeStamp()}] 获取重要新闻时异常:`, error);
    return [];
  }
}

// 按ID获取新闻
export async function getNewsById(newsId) {
  try {
    const { data, error } = await supabase
      .from('news')
      .select('*')
      .eq('id', newsId)
      .single();

    if (error) {
      console.error(`[${getTimeStamp()}] 按ID获取新闻时出错:`, error);
      return null;
    }

    return data;
  } catch (error) {
    console.error(`[${getTimeStamp()}] 按ID获取新闻时异常:`, error);
    return null;
  }
}