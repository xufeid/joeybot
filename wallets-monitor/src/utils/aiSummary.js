import { searchTwitter, getUserTimeline } from './tweetApi.js';
import { sendTelegramMessage } from './telegram.js';
import OpenAI from "openai";
import dotenv from 'dotenv';

const MEME_ANALYSIS_PROMPT = process.env.MEME_ANALYSIS_PROMPT;
const MEME_ANALYSIS_PROMPT_SUFFIX = process.env.MEME_ANALYSIS_PROMPT_SUFFIX;

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com/v1",
});

//转意
function escapeTelegramHtml(text) {
  return text
      .replace(/&/g, '&amp;')   // 一定要先转 &
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
}


// Parse the tweets from jason to map, which will save the prompt length.
export function parseTweets(tweets,type = 'search'){
  let tweetsData = [];
  if (type === 'account') {

    // Process account tweets format
    tweetsData = tweets.tweets.map((tweet, index) => `
Tweet ${index + 1}:
Content: ${tweet.text}
Time: ${tweet.created_at}
Engagement: ${tweet.views} views / ${tweet.favorites} likes 
---`);
  } else {
    // Search tweets

    tweetsData = tweets.map((tweet, index) => `
Tweet ${index + 1}:
Content: ${tweet.text}
Time: ${tweet.created_at}
Author: ${tweet.author.name} (@${tweet.author.screen_name})
Followers: ${tweet.author.followers_count}
Engagement: ${tweet.views} views / ${tweet.favorites} likes 
---`);
  }
  return tweetsData;
}

// Summarizes tweets related to a token from both account and search results
async function sumTweets(tokenInfo) {
  const { symbol, address, twitter } = tokenInfo;

  let account_tweets = [];
  let search_tweets = [];
  let account_tweetsData = [];
  let search_tweetsData = [];

  // 1. First mission
  // Get tweets from Twitter account
  if (twitter && (twitter.includes('x.com/') || twitter.includes('twitter.com/'))) {
    const urlParts = twitter.split('/');
    // Exclude special links
    if (!twitter.includes('/communities/') && !twitter.includes('/search?') && !twitter.includes('/status/')) {
      let screenname = urlParts[urlParts.length - 1].split('?')[0];

      const timelineResult = await getUserTimeline(screenname);
      if (timelineResult) account_tweets = timelineResult;
      else console.log('Failed to fetch user tweets:', screenname);
    }
  }

  // 2. Second mission
  // Search for tweets related to token address
  search_tweets = await searchTwitter(address);

  if (!search_tweets?.length) {
    console.log('No tweets found for address:', address);
    return `No tweet data found for ${symbol}(${address}).`;
  }


  // 1.First mission
  let account_summary = "";
  if (account_tweets?.tweets?.length > 0) {
    account_tweetsData = parseTweets(account_tweets,'account');
    account_summary = await genSum(symbol, account_tweetsData, 'account');
  }

  // 2. Second mission
  //Process tweets format
  let search_summary = "";
  search_tweetsData = parseTweets(search_tweets,'search');
  if(search_tweetsData.length > 0){
    // Ask the DS for tweets summary
    search_summary = await genSum(symbol, search_tweetsData, 'search');
  }

  //3. Third mission
  //the tweets has been proceeded, just need to connect the DS
  let evaluation_report = "";
  if(search_tweetsData.length > 0){
    //Ask the DS to return the evaluation report
    evaluation_report = await genEva(tokenInfo,search_tweetsData);
  }

  if (!account_summary && !search_summary && !evaluation_report) {
    console.log(`Unable to generate tweet analysis summary for ${symbol}.`);
    return null;
  }

  return { search_summary, account_summary, evaluation_report};
}


// Generates summary of tweets using DS,
// 2 types, default is search, and another one is account
async function genSum(symbol, tweetsData, type = 'search') {
  try {
    let promptPrefix = '';
    let promptSuffix = '';

    if (type === 'account') {
      promptPrefix = `请总结关于 ${symbol} 的账号推文:`;
      promptSuffix = `提供简短的要点总结。保持简洁直接,去除所有不必要的词语。`;

    } else {
      // Search tweets
      promptPrefix = `请总结关于 ${symbol} 的搜索推文:`;
      promptSuffix = `提供关于叙事观点和风险内容的极简要点总结。不总结主观价格预测和个人收益的内容。保持简洁直接,去除所有不必要的词语。格式如下：
- 叙事观点：
- 风险内容：`;

    }

    const prompt = `${promptPrefix}

${tweetsData.join('\n')}

${promptSuffix}`;

    const response = await openai.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: "You are a helpful assistant that analyzes cryptocurrency Twitter data." },
        { role: "user", content: prompt }
      ],
      temperature: 1.0,
      max_tokens: 8000
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error("Error generating Twitter summary:", error);
    return "Failed to generate summary due to an error.";
  }
}

// Generates a evaluation of the token using DS
async function genEva(tokenInfo, tweetsData) {
  try {
    const prompt = `${MEME_ANALYSIS_PROMPT}

    #### RAW_TWITTER_DATA (timeline 数组)
${tweetsData.join('\n')}
    #### TOKEN_INFO{
    ${tokenInfo}

${MEME_ANALYSIS_PROMPT_SUFFIX}`;
    console.log(`EVA: Gonna ask the DS for prompt: ${prompt}`);

    const response = await openai.chat.completions.create({
      model: "deepseek-chat",
      messages: [
        { role: "system", content: "You are a helpful assistant that analyzes cryptocurrency " },
        { role: "user", content: prompt }
      ],
      temperature: 1.0,
      max_tokens: 8000
    });
    console.log(`EVA: And the DS said: ${response.choices[0].message.content}`);
    return response.choices[0].message.content;
  } catch (error) {
    console.error("Error generating Twitter summary:", error);
    return "Failed to generate summary due to an error.";
  }
}

// Sends the tweet summary or evaluation report to Telegram as a reply to a message
export async function sendSumMessage(tokenInfo, replyToMessageId) {
  const summaryResult = await sumTweets(tokenInfo);
  if (!summaryResult) {
    console.log(`Unable to get tweet summary for ${tokenInfo.symbol}`);
    return;
  }

  const { search_summary, account_summary, evaluation_report} = summaryResult;

  let message = `\u{1F49B}${tokenInfo.symbol} tweets summary:\n`;

  if (account_summary) {
    // Format line breaks and spaces, replace multiple line breaks with a single one
    const formattedAccountSummary = account_summary
        .replace(/\n\s*\n/g, '\n')
        .trim();
    message += `<blockquote>${formattedAccountSummary}</blockquote>\n\n`;
  }

  if (search_summary) {
    message += `\u{1F49B}Searched tweets summary:\n<blockquote>${search_summary}</blockquote>`;
  }

  if (evaluation_report) {
    const formattedEvaReport = evaluation_report
        .replace(/\n\s*\n/g, '\n')
        .trim();

    const safeReport = escapeTelegramHtml(formattedEvaReport);
    message += `\u{1F49B}AI evaluation:\n<blockquote>${safeReport}</blockquote>`;
  }

  const tgResponse = await sendTelegramMessage(message, replyToMessageId);

  return tgResponse;
}
