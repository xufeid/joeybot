import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

// Sends a message to Telegram chat with optional reply functionality
export async function sendTelegramMessage(message, replyToMessageId = null, chatId = null) {
  const botToken = process.env.TELEGRAM_TOKEN;
  const channelId = process.env.TELEGRAM_CHANNEL_ID;

  // 如果没有指定chatId，则发送到频道
  const targetChatId = String(chatId || channelId);
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: targetChatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_to_message_id: replyToMessageId
      }),
    });

    const data = await response.json();
    // console.log('Telegram response:', data);

    if (!data.ok || data.description?.includes('Unknown error')) {
      throw new Error(`Telegram API error: ${data.description || 'Unknown error'}`);
    }

    return data;
  } catch (error) {
    console.error('Error sending Telegram message:', error);
    throw error;
  }
}

// 专门用于发送消息到频道的函数
export async function sendChannelMessage(message, replyToMessageId = null) {
  return sendTelegramMessage(message, replyToMessageId, process.env.TELEGRAM_CHANNEL_ID);
}

// 专门用于发送消息给用户的函数
export async function sendUserMessage(message, chatId, replyToMessageId = null, options = null) {
  const botToken = process.env.TELEGRAM_TOKEN;
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_to_message_id: replyToMessageId,
        reply_markup: {
          remove_keyboard: true  // 移除自定义键盘
        },
        ...options // 合并额外的选项
      }),
    });

    const data = await response.json();
    if (!data.ok) {
      throw new Error(`Telegram API error: ${data.description || 'Unknown error'}`);
    }

    return data;
  } catch (error) {
    console.error('Error sending user message:', error);
    throw error;
  }
}

