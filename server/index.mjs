import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';

const envPath = fileURLToPath(new URL('.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
const token = process.env.FG_PAIRING_TOKEN;
if (!token || token.length < 32) {
  console.error('請先執行 npm run setup，建立本機配對設定。');
  process.exit(1);
}
const apiKey = process.env.OPENAI_API_KEY || '';
const dailyLimit = Number(process.env.FG_DAILY_LIMIT || 2000);
if (!Number.isInteger(dailyLimit) || dailyLimit < 1) throw new Error('FG_DAILY_LIMIT must be a positive integer.');
const app = createApp({ token, apiKey, dailyLimit });
app.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? '連接埠 43187 已被使用，請確認是否已啟動服務。' : '本機服務啟動失敗。');
  process.exitCode = 1;
});
app.listen(43187, '127.0.0.1', () => {
  console.log('清朗本機服務已啟動：http://127.0.0.1:43187');
  console.log(apiKey ? 'OpenAI 金鑰已設定。按 Ctrl+C 停止。' : '尚未設定 OpenAI 金鑰；可測試連線，但貼文會保持遮擋。');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close(() => process.exit(0)));
