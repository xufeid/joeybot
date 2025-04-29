import { searchTwitter } from '../tweetApi.js';
import { sendUserMessage } from '../telegram.js';
import OpenAI from "openai";
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { sendUserStatusToAdmin } from './bot_admin.js';
import {
  checkUserUsageLimit,
  updateUserUsage,
  logUserUsage,
  getOrCreateUserSession,
  updateUserSessionContext,
  cleanupExpiredSessions,
  ensureUserExists
} from '../users/user.js';
import { generateUsageMessage, generateSubscriptionInfo, generateHelpMessage } from '../users/menu.js';

dotenv.config();

// 创建 Supabase 客户端
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com/v1",
});

// 存储用户会话状态
const userSessions = new Map();
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30分钟超时

// 记录用户交互
async function logUserInteraction(userId, question, stage, additionalData = {}) {
  try {
    // 获取用户信息
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, username, first_name, last_name')
      .eq('telegram_id', userId)
      .single();

    if (userError) {
      console.error(`[${getTimeStamp()}] Error getting user info:`, userError);
      return; // 如果获取用户信息失败，直接返回
    }

    if (!user) {
      console.error(`[${getTimeStamp()}] User not found for telegram_id:`, userId);
      return; // 如果用户不存在，直接返回
    }

    const logData = {
      user_id: user.id, // 使用数据库中的用户 ID
      question: question,
      stage: stage,
      created_at: new Date().toISOString(),
      username: user.username || null,
      first_name: user.first_name || null,
      last_name: user.last_name || null,
      ...additionalData
    };

    const { error } = await supabase
      .from('user_usage_logs')
      .insert([logData]);

    if (error) {
      console.error(`[${getTimeStamp()}] Error logging user interaction:`, error);
    }
  } catch (error) {
    console.error(`[${getTimeStamp()}] Error in logUserInteraction:`, error);
  }
}

// 处理用户问题
export async function handleUserQuestion(userId, question, username = null, firstName = null, lastName = null) {
  // 确保 question 是字符串类型
  const questionText = String(question || '').trim();

  console.log(`[${getTimeStamp()}] Handling question from user ${userId} (${username || firstName || 'Unknown'}): ${questionText}`);

  try {
    // 确保用户存在
    await ensureUserExists(userId, username, firstName, lastName);

    // 记录用户提问
    await logUserInteraction(userId, questionText, 'question');

    // 处理命令
    if (questionText.startsWith('/')) {
      const command = questionText.split(' ')[0].toLowerCase();
      switch (command) {
        case '/usage':
          const usageMessage = await generateUsageMessage(userId);
          return { message: usageMessage };
        case '/subscription':
          return {
            message: generateSubscriptionInfo()
          };
        case '/recharge':
          return {
            message: '请通过以下方式充值：\n\n1. 联系客服 @Chainsmonitor_support\n2. 获取支付地址\n3. 支付后24小时内开通服务'
          };
        case '/status':
          const statusMessage = await generateUsageMessage(userId);
          return { message: statusMessage };
        case '/help':
          return {
            message: generateHelpMessage()
          };
        case '/start':
          // 获取用户信息
          const { user: startUser } = await checkUserUsageLimit(userId, true, username, firstName, lastName);
          let startGreeting = '';
          if (startUser && startUser.subscription_status === 'paid') {
            const name = username || firstName || '尊敬的订阅用户';
            startGreeting = `${name}，您好！`;
          } else {
            const name = username || firstName || '用户';
            startGreeting = `${name}，您好！`;
          }
          return {
            message: `${startGreeting}我是ChainsMonitor_Bot，一个智能加密货币助手。我可以帮你：\n\n` +
                    '• 查询最新的二级市场动态\n' +
                    '• 获取代币的内部消息和项目进展\n' +
                    '• 查看币安等交易所的最新上币信息\n' +
                    '• 分析代币的技术面和基本面\n' +
                    '• 提供加密货币投资建议\n\n' +
                    '有什么我可以帮你的吗？'
          };
      }
    }

    // 检查是否是问候语
    const isGreeting = /^(hi|hello|你好|嗨|早上好|下午好|晚上好)$/i.test(questionText);

    // 如果是问候语，直接返回问候回应
    if (isGreeting) {
      // 获取用户信息
      const { user } = await checkUserUsageLimit(userId, true, username, firstName, lastName);
      
      let greeting = '';
      if (user && user.subscription_status === 'paid') {
        // 订阅用户
        const name = username || firstName || '尊敬的订阅用户';
        greeting = `${name}，您好！`;
      } else {
        // 普通用户
        const name = username || firstName || '用户';
        greeting = `${name}，您好！`;
      }
      
      return {
        message: `${greeting}我是ChainsMonitor_Bot，一个智能加密货币助手。我可以帮你：\n\n` +
                '• 查询最新的二级市场动态\n' +
                '• 获取代币的内部消息和项目进展\n' +
                '• 查看币安等交易所的最新上币信息\n' +
                '• 分析代币的技术面和基本面\n' +
                '• 提供加密货币投资建议\n\n' +
                '有什么我可以帮你的吗？'
      };
    }

    // 检查用户使用限制
    const { canUse, message: limitMessage, isNewUser } = await checkUserUsageLimit(userId, false, username, firstName, lastName);
    
    if (isNewUser) {
      return {
        message: '欢迎使用 ChainsMonitor！\n\n' + limitMessage
      };
    }

    if (!canUse) {
      return {
        message: limitMessage
      };
    }

    try {
      // 使用AI分析问题并判断是否与数字货币相关，同时生成搜索关键词
      const analysisResult = await analyzeQuestionAndGenerateResponse(questionText, userId);

      // 记录AI对问题的理解
      await logUserInteraction(userId, questionText, 'understanding', {
        ai_understanding: analysisResult
      });

      // 如果不是数字货币相关问题，直接返回AI的回答
      if (!analysisResult.is_crypto) {
        // 记录最终回答
        await logUserInteraction(userId, questionText, 'answer', {
          answer: analysisResult.response,
          is_error: false
        });
        return {
          message: analysisResult.response
        };
      }

      // 发送初步回应
      await sendUserMessage(analysisResult.response, userId);

      // 使用关键词搜索Twitter
      const tweets = await searchTwitter(analysisResult.keywords);
      if (!tweets || tweets.length === 0) {
        const noResultMessage = `抱歉，我没有找到相关的信息。\n\n请尝试用其他方式描述你的问题。`;
        // 记录最终回答
        await logUserInteraction(userId, questionText, 'answer', {
          answer: noResultMessage,
          is_error: false
        });
        return {
          message: noResultMessage
        };
      }

      // 使用AI分析搜索结果并生成回答
      const answer = await generateAnswer(questionText, tweets, userId);

      // 更新用户使用次数
      await updateUserUsage(userId);

      // 记录最终回答
      await logUserInteraction(userId, questionText, 'answer', {
        answer: answer,
        is_error: false
      });

      return {
        message: answer
      };

    } catch (error) {
      console.error(`[${getTimeStamp()}] Error handling user question:`, error);
      const errorMessage = '抱歉，处理你的问题时出现了错误。请稍后再试。';
      // 记录错误情况
      await logUserInteraction(userId, questionText, 'error', {
        answer: errorMessage,
        is_error: true,
        error_details: error.message
      });
      return {
        message: errorMessage
      };
    }
  } catch (error) {
    console.error(`[${getTimeStamp()}] Error in handleUserQuestion:`, error);
    return {
      message: '抱歉，系统出现错误。请稍后再试。'
    };
  }
}

// 合并后的函数：分析问题并生成初步回应和搜索关键词
async function analyzeQuestionAndGenerateResponse(question, userId) {
  // 获取用户会话上下文
  const session = getOrCreateUserSession(userId);
  const context = session.context || [];

  // 构建上下文提示
  const contextPrompt = context.length > 0 
    ? `对话上下文：\n${context.join('\n')}\n\n`
    : '';

  const prompt = `请分析以下对话并按照指定格式输出 JSON：

${contextPrompt}当前问题：${question}

要求：
首先：回答和用户提问一样的语言
1. 判断问题是否与数字货币相关：
   - 如果问题涉及加密货币、区块链、代币、交易所、投资等，返回 "is_crypto": true
   - 如果问题与这些无关，返回 "is_crypto": false
   - 在判断时要结合上下文，如果上下文是关于加密货币的对话，新问题即使看起来不相关也可能是在延续加密货币话题

2. 如果 is_crypto 为 true：
   - 提取最核心的搜索关键词
   - 保持搜索词尽可能简短，以增加搜索结果数量
   - 不要包含问号等标点符号
   - 如果问题包含特定的人名、项目名或代币地址，请保持原样
   - 如果问题包含多个概念，优先选择最重要的1-2个进行搜索
   - 用自然的语言表达你理解了他的问题
   - 表达你愿意帮助他
   - 说明你会仔细分析相关信息来回答他的问题
   - 请他稍等片刻
   - 不要透露具体的数据来源或分析方法
   - 如果用户直接发送出现一串类似于"25MXdVVhQ2fnXmBdiL2pSWZojnV5odMZPtKbCXzRpump"的地址或者乱码，你可以直接搜索这个地址，它有可能是一个代币的合约地址，或者是一个钱包地址
   - 用户问的问题大概率是crypto相关的，所以当出现一些奇怪的短语或者生词时，可以尝试给它加上$符号，让它可以在搜索的时候被认为是代币

3. 如果 is_crypto 为 false：
   a. 如果用户询问你的身份，请用友好的语气回答你是 ChainsMonitor 的加密货币智能助手，专注于提供加密货币相关的信息和建议
   b. 如果没有询问身份，则直接回答问题：
      - 先用亲切的语气表达自己对这个领域可能不是那么在行，然后再回答用户问题
      - 分段，举例结构，详细展开
      - 最后做一个简要小结
      - 保持语气温暖友好

4. 使用与问题相同的语言回应
5. 在回应中使用用户的名字（如果在上下文中有提到）增加个性化体验
6. 避免过于机械或官方的语气，使用更加口语化、自然的表达

请严格按照以下 JSON 格式输出：
{
  "is_crypto": boolean,
  "response": string,
  "keywords": string (仅当 is_crypto 为 true 时)
}`;

  const response = await openai.chat.completions.create({
    model: "deepseek-chat",
    messages: [
      { role: "system", content: "You are a helpful assistant that analyzes questions and provides responses in a specific JSON format. You are a professional cryptocurrency agent from ChainsMonitor, focused on providing crypto-related information and advice." },
      { role: "user", content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 2000,
    response_format: { type: "json_object" }
  });

  try {
    const result = JSON.parse(response.choices[0].message.content);
    
    // 更新会话上下文
    if (context.length >= 10) { // 限制上下文长度
      context.shift(); // 移除最旧的上下文
    }
    context.push(`用户: ${question}`);
    context.push(`助手: ${result.response}`);
    updateUserSessionContext(userId, context);
    
    return result;
  } catch (error) {
    console.error(`[${getTimeStamp()}] Error parsing AI response:`, error);
    return {
      is_crypto: false,
      response: "抱歉，处理你的问题时出现了错误。请稍后再试。"
    };
  }
}

// 使用AI生成回答
async function generateAnswer(question, tweets, userId) {
  // 格式化推文数据
  const formattedTweets = tweets.map((tweet, index) => `
推文 ${index + 1}:
内容：${tweet.text}
作者：${tweet.author.name} (@${tweet.author.screen_name})
作者粉丝数：${tweet.author.followers_count}
时间：${tweet.created_at}
互动：${tweet.views} 浏览 / ${tweet.favorites} 点赞 / ${tweet.retweets} 转发
评论数：${tweet.replies}
---`).join('\n');

  const prompt = `你是一个加密货币领域的专家，请根据以下Twitter搜索结果，回答用户的问题：

当前问题：${question}

Twitter搜索结果：
${formattedTweets}

要求：
1. 作为加密货币专家，基于搜索结果提供准确的信息，请不要返回任何和数据源的信息，例如"推文xxx"这样的信息！
2. 优先考虑以下因素的信息，优先级从上向下：
   - 24小时内的最新信息
   - 来自知名加密货币KOL或项目方的信息
   - 点赞和转发数高的推文
   - 评论数多的推文
   - 作者粉丝数多的推文
3. 在用户问最新价格、最新事件、今天的市场情况、新闻等问题时，让消息的时效性为最为重要的因素
4. 如果搜索结果不足以回答问题，请说明
5. 保持回答简洁明了
6. 以"根据最新信息"这类文字作为回答的开头
7. 使用与问题相同的语言回答,如果搜索结果包含多种语言，确保回答使用与问题相同的语言
8. 在回答中标注信息的时效性，去掉引用推文的介绍，不要出现"从twitter信息来看"这样的文字，就说从最新的信息来看
9. 对信息进行交叉验证，确保准确性。如果发现矛盾的信息，说明原因并给出最可能的解释
10. 在回答中体现你的专业判断
11. 考虑之前的对话上下文，确保回答与上下文连贯
12. 如果当前问题与之前的对话相关，在回答中适当引用之前的讨论
13. 因为用户大概率都是炒币或者是数字货币从业者，如果用户问的是代币等问题，可以在最后给用户加点吉祥话，例如祝用户多赚钱，祝用户买的币起飞等。让吉祥话看起来是你这边的祝福，而不是我们设计好的一个模板
14. 不要给用户透露数据来源

请直接返回回答内容，不要包含其他内容。`;

  const response = await openai.chat.completions.create({
    model: "deepseek-chat",
    messages: [
      { role: "system", content: "You are a cryptocurrency expert assistant that analyzes and synthesizes information from Twitter, with a focus on accuracy and reliability, while maintaining conversation context." },
      { role: "user", content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 2000
  });

  const answer = response.choices[0].message.content;

  // 获取用户信息
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('username, first_name, last_name')
    .eq('telegram_id', userId)
    .single();

  if (!userError && user) {
    // 发送用户状态到管理员频道
    await sendUserStatusToAdmin(
      {
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name
      },
      question,
      answer
    );
  }

  return answer;
}

// 获取时间戳
function getTimeStamp() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}