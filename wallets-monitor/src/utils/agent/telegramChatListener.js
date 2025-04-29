import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { handleUserQuestion } from './answer.js';
import { sendUserMessage } from '../telegram.js';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_TOKEN;
let lastUpdateId = 0;

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
async function getUpdates() {
  try {
    const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        offset: lastUpdateId + 1,
        timeout: 30, // 长轮询超时时间
        allowed_updates: ['message'] // 只接收消息更新
      }),
    });

    const data = await response.json();
    if (!data.ok) {
      throw new Error(`Telegram API error: ${data.description}`);
    }

    return data.result;
  } catch (error) {
    console.error(`[${getTimeStamp()}] Error getting updates:`, error);
    return [];
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
  console.log(`[${getTimeStamp()}] Starting Telegram bot...`);

  // 设置 bot 命令
  await setBotCommands();

  while (true) {
    try {
      const updates = await getUpdates();

      for (const update of updates) {
        if (update.message) {
          await processMessage(update.message);
        }
        lastUpdateId = update.update_id;
      }
    } catch (error) {
      console.error(`[${getTimeStamp()}] Error in bot loop:`, error);
      // 等待一段时间后重试
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
} 