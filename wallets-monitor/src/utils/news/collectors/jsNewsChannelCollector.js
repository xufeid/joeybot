import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// 初始化目标频道ID列表，将在启动函数中解析环境变量赋值
let TARGET_CHANNEL_IDS = [];

// 获取时间戳
function getTimeStamp() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

// 创建 Supabase 客户端
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Telegram API 配置
const API_ID = parseInt(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH;
const PHONE_NUMBER = process.env.TELEGRAM_PHONE_NUMBER;
const SESSION_STRING = process.env.TELEGRAM_SESSION_STRING;

// 获取带 -100 前缀的频道 ID（用于 API 调用）
function getFullChannelId(channelId) {
  return BigInt(`-100${channelId}`);
}

// 创建 Telegram 客户端
const client = new TelegramClient(
  new StringSession(SESSION_STRING),
  API_ID,
  API_HASH,
  { connectionRetries: 5 }
);

// 处理新消息
async function handleNewMessage(event) {
  try {
    const message = event.message;
    
    // 打印所有接收到的消息
    // console.log(`[${getTimeStamp()}] 收到消息:`, {
    //   message_id: message.id,
    //   peer_id: message.peerId,
    //   channel_id: message.peerId?.channelId,
    //   text: message.text,
    //   date: message.date,
    //   from_id: message.fromId,
    //   is_channel: message.peerId?.channelId ? true : false
    // });
    
    // 检查消息是否来自目标频道
    if (message.peerId?.channelId) {
      const channelId = message.peerId.channelId;
      const channelIdStr = channelId.toString();
      const isTarget = TARGET_CHANNEL_IDS.some(targetId => targetId.toString() === channelIdStr);
      
      if (isTarget) {
        const channel = await message.getChat();
        console.log(`[${getTimeStamp()}] 目标频道消息:`, {
          channel: channel.title,
          message_id: message.id,
          text: message.text?.substring(0, 100) // 只显示前100个字符
        });

        // 保存消息到数据库
        const { error } = await supabase
          .from('news')
          .insert({
            news_title: message.text.substring(0, 200),
            news_content: message.text,
            source_name: 'TGNewsChannel',
            url: `https://t.me/c/${channelIdStr}/${message.id}`,
            timestamp: message.date,
            is_analyzed: false,
            published: false
          });

        if (error) {
          console.error(`[${getTimeStamp()}] 保存消息到数据库时出错:`, error);
        } else {
          console.log(`[${getTimeStamp()}] 成功保存消息到数据库`);
        }
      }
    }
  } catch (error) {
    console.error(`[${getTimeStamp()}] 处理新消息时出错:`, error);
  }
}

// 启动收集器
export async function startTGNewsChannelCollector() {
  try {
    console.log(`[${getTimeStamp()}] 启动 Telegram 新闻频道收集器...`);
    // 解析频道ID环境变量并赋值给全局 TARGET_CHANNEL_IDS
    TARGET_CHANNEL_IDS = process.env.TELEGRAM_NEWS_FROM_CHANNEL_IDS
      .split(',')
      .map(id => {
        try {
          const cleanId = id.trim().replace('-100', '').replace('n', '');
          const parsedId = BigInt(cleanId);
          console.log(`[${getTimeStamp()}] 解析频道ID:`, { original: id, clean: cleanId, parsed: parsedId });
          return parsedId;
        } catch (error) {
          console.error(`[${getTimeStamp()}] 解析频道ID出错:`, { id, error: error.message });
          return null;
        }
      })
      .filter(id => id !== null);
    console.log(`[${getTimeStamp()}] 目标频道ID:`, TARGET_CHANNEL_IDS);

    // 连接客户端
    await client.connect();
    console.log(`[${getTimeStamp()}] 已连接到 Telegram`);

    // 如果还没有登录，进行登录
    if (!await client.isUserAuthorized()) {
      await client.start({
        phoneNumber: PHONE_NUMBER,
        phoneCode: async () => {
          const code = await new Promise(resolve => {
            console.log('请输入验证码:');
            process.stdin.once('data', data => resolve(data.toString().trim()));
          });
          return code;
        },
        password: async () => {
          const password = await new Promise(resolve => {
            console.log('请输入两步验证密码:');
            process.stdin.once('data', data => resolve(data.toString().trim()));
          });
          return password;
        },
        onError: (err) => console.error(`[${getTimeStamp()}] 登录错误:`, err),
      });
      
      // 获取并打印会话字符串
      const sessionString = client.session.save();
      console.log(`[${getTimeStamp()}] 登录成功，会话字符串:`, sessionString);
      console.log(`[${getTimeStamp()}] 请将此字符串保存到 .env 文件的 TELEGRAM_SESSION_STRING 中`);
    }

    // 验证频道访问权限
    for (const channelId of TARGET_CHANNEL_IDS) {
      try {
        const fullChannelId = getFullChannelId(channelId);
        // 尝试获取频道信息
        const channel = await client.getEntity(fullChannelId);
        console.log(`[${getTimeStamp()}] 频道信息:`, {
          id: channelId.toString(),
          full_id: fullChannelId.toString(),
          title: channel.title,
          username: channel.username,
          access_hash: channel.accessHash
        });

        // 尝试获取最近的消息
        const messages = await client.getMessages(fullChannelId, { limit: 1 });
        console.log(`[${getTimeStamp()}] 可以访问频道 ${channel.title} 的消息`);
      } catch (error) {
        console.error(`[${getTimeStamp()}] 无法访问频道 ${channelId}:`, error);
        console.log(`[${getTimeStamp()}] 请确保账号已加入该频道，并且频道ID正确`);
      }
    }

    // 添加新消息事件监听器
    client.addEventHandler(handleNewMessage, new NewMessage({}));

    console.log(`[${getTimeStamp()}] 开始监听频道:`, TARGET_CHANNEL_IDS);

    // 返回停止函数
    return {
      stop: async () => {
        await client.disconnect();
        console.log(`[${getTimeStamp()}] Telegram 新闻频道收集器已停止`);
      }
    };
  } catch (error) {
    console.error(`[${getTimeStamp()}] 启动 Telegram 新闻频道收集器时出错:`, error);
    throw error;
  }
}

// 导出默认函数
export default startTGNewsChannelCollector; 