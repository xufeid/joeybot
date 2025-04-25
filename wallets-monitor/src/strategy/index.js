import { DexScreener } from '../utils/dexscreener.js';
import { createClient } from '@supabase/supabase-js';
import { SOL_ADDRESS, USDC_ADDRESS } from '../utils/swapProcessor.js';
import { sendTelegramMessage } from '../utils/telegram.js';
import { analyzeTokenTxs } from '../utils/txsAnalyzer.js';
import { createMsg } from './messageTemplate.js';
import { sendSumMessage } from '../utils/aiSummary.js';
import { startBot } from '../utils/telegramChatListener.js';
import dotenv from 'dotenv';

dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Configuration constants
const BUY_INTERVAL_HOURS = process.env.FILTER_BUY_INTERVAL_HOURS;
const MAX_AGE_DAYS = process.env.FILTER_MAX_AGE_DAYS;
const MIN_MARKET_CAP = process.env.FILTER_MIN_MARKET_CAP;
const SCORE_CRITERIAL = process.env.FILTER_SCORE_CRITERIAL;

const getTimeStamp = () => {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
};

// Check if token meets filtering criteria
async function checkFilter(tokenAddress) {
  try {
    const tokenInfo = await DexScreener.getTokenInfo('solana', tokenAddress);
    if (!tokenInfo) return;

    const pairAge = (Date.now() / 1000 - tokenInfo.createdAt) / (60 * 60 * 24);
    console.log(`token ${tokenAddress} 's information: Market Cap: [${tokenInfo.marketCap}], PairAge: [${pairAge}]`);
    if (pairAge <= MAX_AGE_DAYS && tokenInfo.marketCap >= MIN_MARKET_CAP) {
      const analysis = await analyzeTokenTxs(tokenAddress);

      // Create and send message to Telegram
      const message = createMsg(tokenInfo, analysis);
      
      try {
        const tgResponse = await sendTelegramMessage(message);
        
        if (tgResponse?.ok === true) {
          const messageId = tgResponse.result.message_id;
          // Send AI summary message with error handling
          try {
            await sendSumMessage(tokenInfo, messageId);
            console.log(`[${getTimeStamp()}] Successfully sent analysis for token ${tokenAddress} to Telegram`);
          } catch (sumError) {
            console.error(`[${getTimeStamp()}] Error sending AI summary: `, sumError);
            // 发送一个简单的错误通知
            await sendTelegramMessage(`⚠️ AI分析生成失败，请稍后重试\n代币地址: ${tokenAddress}`);
          }
        }
      } catch (tgError) {
        console.error(`[${getTimeStamp()}] Error sending Telegram message: `, tgError);
      }
    }
  } catch (error) {
    console.error(`[${getTimeStamp()}] Error checking token ${tokenAddress}:`, error);
  }
}

// Subscribe to INSERT events on the txs table
async function startMonitor() {
  supabase
      .channel('txs_monitor')
      .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'txs',
          },
          async (payload) => {
            const newTx = payload.new;
            const tokenOutAddress = newTx.token_out_address;
            const currentAccount = newTx.account;
            const currentTimestamp = newTx.timestamp;

            // 查询对应wallet的score
            const { data: walletData, error: walletError } = await supabase
                .from('wallets')
                .select('score')
                .eq('address', currentAccount)
                .single();

            if (walletError) {
              console.error(`[${getTimeStamp()}] Error fetching wallet score:`, walletError);
              return;
            }

            console.log(`[${getTimeStamp()}] Wallet score for ${currentAccount}:`, walletData.score);

            // 更新txs表中的score字段
            const { error: updateError } = await supabase
                .from('txs')
                .update({ score: walletData.score })
                .eq('id', newTx.id);

            if (updateError) {
              console.error(`[${getTimeStamp()}] Error updating tx score:`, updateError);
              return;
            }

            // 使用wallet的score作为当前交易的score
            const currentTxScore = walletData.score;
            console.log(`[${getTimeStamp()}] Current tx score:`, currentTxScore);

            // Check if it's not SOL or USDC (buy transaction)
            if (tokenOutAddress !== SOL_ADDRESS && tokenOutAddress !== USDC_ADDRESS) {
              const someHoursAgo = new Date(currentTimestamp);
              someHoursAgo.setHours(someHoursAgo.getHours() - BUY_INTERVAL_HOURS);
              const someHoursAgoTimestamp = Math.floor(someHoursAgo.getTime() / 1000);

              // Query if other wallets bought this token in the last 6 hours
              const { data, error } = await supabase
                  .from('txs')
                  .select('*')
                  .eq('token_out_address', tokenOutAddress)
                  .neq('account', currentAccount)
                  .gte('timestamp', someHoursAgoTimestamp);
              //    .limit(1);

              if (error) {
                console.error(`[${getTimeStamp()}] Query error:`, error);
                return;
              }

              // 计算代币的总分数
              let totalScore = 0;
              const processedAccounts = new Set(); // 用于记录已经处理过的账户

              // 先加上当前交易的score
              totalScore += currentTxScore;
              processedAccounts.add(currentAccount);

              // 如果有其他交易，遍历并累加分数
              if (data && data.length > 0) {
                console.log(`[${getTimeStamp()}] Detected new multi-wallet transaction for token: ${tokenOutAddress}`);

                // 遍历其他交易数据
                for (const tx of data) {
                  const account = tx.account;

                  // 如果这个账户已经处理过，跳过
                  if (processedAccounts.has(account)) {
                    continue;
                  }

                  // 标记这个账户为已处理
                  processedAccounts.add(account);

                  // 累加这个账户的score
                  totalScore += tx.score;
                }
              }

              console.log(`[${getTimeStamp()}] Total score for token ${tokenOutAddress}: ${totalScore}`);

              // 检查总分数是否达到标准
              if (totalScore < SCORE_CRITERIAL) {
                console.log(`[${getTimeStamp()}] Total score ${totalScore} is less than criteria ${SCORE_CRITERIAL}, skipping...`);
                return;
              }

              // 如果分数达标，继续执行filter检查
              await checkFilter(tokenOutAddress);
            }
          }
      )
      .on('error', (error) => {
        console.error(`[${getTimeStamp()}] Supabase realtime connection error:`, error);
      })
      .subscribe((status) => {
        console.log(`[${getTimeStamp()}] Monitoring started... Subscription status:`, status);
      })
}

// Start monitoring and Telegram bot
Promise.all([
  startMonitor(),
  startBot()
]).catch(error => {
  console.error(`[${getTimeStamp()}] Program error:`, error);
  process.exit(1);
});


