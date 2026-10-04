import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { writeFile, access, chmod } from 'node:fs/promises';

const file = new URL('.env', import.meta.url);
let mute = false;
const output = new Writable({ write(chunk, encoding, done) { if (!mute) process.stdout.write(chunk); done(); } });
const rl = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY) });
try {
  let exists = false;
  try { await access(file); exists = true; } catch {}
  if (exists && (await rl.question('已有設定。重新建立將使舊配對碼失效，繼續？輸入 yes：')).trim() !== 'yes') process.exit(0);
  process.stdout.write('貼上 OpenAI API key（不顯示內容；直接 Enter 可稍後設定）：');
  mute = true;
  const key = (await rl.question('')).trim();
  mute = false;
  process.stdout.write('\n');
  if (key && !/^[A-Za-z0-9_-]+$/.test(key)) throw new Error('金鑰格式不正確，未寫入。');
  const token = randomBytes(32).toString('hex');
  await writeFile(file, `OPENAI_API_KEY=${key}\nFG_PAIRING_TOKEN=${token}\nFG_DAILY_LIMIT=2000\n`, { mode: 0o600 });
  await chmod(file, 0o600);
  console.log('\n本機配對碼（貼到擴充功能設定；這不是 OpenAI 金鑰）：\n' + token);
  console.log('\n接著執行 npm start。請勿分享 server/.env。');
} finally { mute = false; rl.close(); }
