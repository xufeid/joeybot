import { sendTelegramMessage } from "../telegram.js";
import dotenv from "dotenv";

dotenv.config();

/**
 * 向管理员频道发送用户使用状态
 * @param {Object} userInfo - 用户信息
 * @param {string} userInfo.username - 用户名
 * @param {string} userInfo.firstName - 用户名字
 * @param {string} userInfo.lastName - 用户姓氏
 * @param {string} question - 用户的问题
 * @param {string} answer - AI的回答
 */
export async function sendUserStatusToAdmin(userInfo, question, answer) {
    try {
        const { username, firstName, lastName } = userInfo;

        // 构建用户显示名称
        const userDisplayName = username
            ? `@${username}`
            : `${firstName || ''} ${lastName || ''}`.trim() || 'Unknown User';

        // 构建消息内容
        const message = `
👤 <b>User Activity Report</b>

<b>User:</b> ${userDisplayName}
<b>Question:</b> ${question}
<b>Answer:</b> ${answer}

<i>Timestamp:</i> ${new Date().toISOString()}
    `;

        console.log('Sending message to admin channel:', {
            message: message,
            channelId: process.env.ADMIN_CHANNEL_ID,
            channelIdType: typeof process.env.ADMIN_CHANNEL_ID
        });

        // 发送消息到管理员频道
        await sendTelegramMessage(
            message,
            null, // replyToMessageId
            process.env.ADMIN_CHANNEL_ID
        );

        console.log(`[${new Date().toISOString()}] User status sent to admin channel for user: ${userDisplayName}`);
    } catch (error) {
        console.error("Error sending user status to admin channel:", error);
        throw error;
    }
}
