import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { handleUserQuestion } from './answer.js';
import { sendUserMessage } from '../telegram.js';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_TOKEN;

// 设置 bot 命令
async function setBotCommands() {
  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setMyCommands`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        commands: [
          { command: 'start', description: '开始使用机器人' },
          { command: 'help', description: '查看帮助信息' },
          { command: 'usage', description: '查看使用情况' },
          { command: 'subscription', description: '订阅服务说明' },
          { command: 'status', description: '查看订阅状态' },
          { command: 'recharge', description: '充值订阅' }
        ]
      }),
    });

    const data = await response.json();
    if (!data.ok) {
      throw new Error(`Failed to set bot commands: ${data.description}`);
    }
    console.log(`[${getTimeStamp()}] Bot commands set successfully`);
  } catch (error) {
    console.error(`[${getTimeStamp()}] Error setting bot commands:`, error);
  }
}

// 获取新消息
async function getUpdates(offset = 0) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset}&timeout=30`);
    const data = await response.json();
    
    if (!data.ok) {
      if (data.description?.includes('terminated by other getUpdates request')) {
        console.log(`[${getTimeStamp()}] 检测到其他 bot 实例正在运行，等待 5 秒后重试...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        return getUpdates(offset); // 递归重试
      }
      throw new Error(`Telegram API error: ${data.description}`);
    }
    
    return data.result;
  } catch (error) {
    console.error(`[${getTimeStamp()}] Error getting updates:`, error);
    // 如果是网络错误，等待后重试
    if (error.message.includes('fetch failed') || error.message.includes('terminated by other getUpdates request')) {
      console.log(`[${getTimeStamp()}] 等待 5 秒后重试...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      return getUpdates(offset);
    }
    throw error;
  }
}

// 处理消息
async function processMessage(message) {
  const chatId = message.chat.id;
  const text = message.text;
  const username = message.from?.username;
  const firstName = message.from?.first_name;
  const lastName = message.from?.last_name;

  if (!text) return;

  console.log(`[${getTimeStamp()}] Received message from ${chatId} (${username || firstName || 'Unknown'}): ${text}`);

  try {
    // 处理用户问题，确保传递正确的chatId和用户信息
    const response = await handleUserQuestion(chatId, text, username, firstName, lastName);
    
    if (response && response.message) {
      // 发送回复消息给用户
      await sendUserMessage(response.message, chatId);
      console.log(`[${getTimeStamp()}] Sent response to ${chatId}`);
    }
  } catch (error) {
    console.error(`[${getTimeStamp()}] Error processing message:`, error);
    // 发送错误消息给用户
    await sendUserMessage('抱歉，处理您的消息时出现了错误。请稍后再试。', chatId);
  }
}

// 获取时间戳
function getTimeStamp() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

// 启动消息监听
export async function startBot() {
  console.log(`[${getTimeStamp()}] 启动 Telegram bot...`);
  let lastUpdateId = 0;
  
  while (true) {
    try {
      const updates = await getUpdates(lastUpdateId);
      
      if (updates && updates.length > 0) {
        for (const update of updates) {
          if (update.update_id > lastUpdateId) {
            lastUpdateId = update.update_id;
            
            if (update.message) {
              const chatId = update.message.chat.id;
              const text = update.message.text;
              
              console.log(`[${getTimeStamp()}] 收到消息:`, {
                chatId,
                text,
                from: update.message.from.username
              });
              
              // 处理命令
              await processMessage(update.message);
            }
          }
        }
      }
    } catch (error) {
      console.error(`[${getTimeStamp()}] Bot 运行错误:`, error);
      // 如果是严重错误，等待更长时间后重试
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
} 