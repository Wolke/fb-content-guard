# 開發者部署手冊：Cloudflare 免費方案

本頁只供專案維護者使用。一般使用者不需要執行指令，也不用申請任何金鑰。

## 上線前條件

1. 使用專案擁有者 Cloudflare 帳戶，確認 Workers 與 D1 都是 Free；既有帳戶若為 Paid，先討論，不直接部署。
2. 使用專案專用 OpenAI API key；以帳戶 Limits 實際頁面確認可用的 RPM／TPM／RPD，必要時調低本服務限額。
3. 完成本機模擬、workerd/D1、圖片和合成 Chrome 測試。
4. 本後台接觸 Facebook 貼文；先發布 0.2.0 專用政策並更新商店資料，不能沿用 0.1.0「開發者沒有接收伺服器」的政策。

## 維護者操作

```bash
npm ci
npx wrangler login
npx wrangler d1 create fb-content-guard-usage
```

`wrangler login` 需要帳戶擁有者在官方頁面登入並授權。先確認新增資料庫屬自己的免費帳戶。將 `cloud/wrangler.jsonc` 複製為已被 gitignore 排除的 `cloud/wrangler.local.jsonc`；填入剛建立的 `database_id`，其餘主機、DB binding 及 extension ID 保持一致。正式商店 ID 是 `pgncaeldodjlhkgmkknppnjephnnoobf`。

```bash
npx wrangler d1 migrations apply fb-content-guard-usage --remote --config cloud/wrangler.local.jsonc
npx wrangler deploy --config cloud/wrangler.local.jsonc
npx wrangler secret put OPENAI_API_KEY --config cloud/wrangler.local.jsonc
```

初次部署 `SERVICE_ENABLED=false`，尚未接收分類。將金鑰填進 CLI 秘密提示，不寫入設定檔或聊天。再由維護者產生並設定服務簽章秘密：

```bash
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))" | npx wrangler secret put SESSION_SECRET --config cloud/wrangler.local.jsonc
```

不要顯示或保存此命令輸出的值到原始碼。設定兩個 secrets 後，在 local 設定將 `SERVICE_ENABLED` 改為 `true` 再部署；開啟官方提供的 HTTPS workers.dev 網址。不要使用可被回收的臨時帳戶部署正式服務。

```bash
npx wrangler deploy --config cloud/wrangler.local.jsonc
python3 scripts/configure_cloud.py https://正式的服務主機
```

`/v1/health` 只驗證服務設定及版本，**不驗證金鑰有效、D1 schema、OpenAI 分類或免費 CPU 是否足夠**。這些必須另外實測。

## 真實驗收與發行

- 在乾淨 Chrome 環境載入配置後的 extension；未同意不得發送圖片或貼文。無 API key、無 Node.js 的終端使用者仍應可用。
- 用合成、安全的文字和圖片先驗證正式 Worker／D1／OpenAI，不為測試刻意傳送非法素材。之後在使用者同意下確認真實 Facebook DOM 適配。
- 驗證畫面先遮擋、分類結果、手動顯示、快速捲動、撤回同意、錯誤、超量、換網路、重新啟動。
- 在 Cloudflare 檢查實際 CPU 與 D1 讀寫；Free 單次 CPU 限制下若有失敗，不宣稱完成、不自動升級付費，改小資料或討論替代。
- 檢查日誌未記錄貼文、圖片或 token；確認 cron 工作已執行，48 小時前資料會移除。D1 內建備份保留須如實揭露。
- `npm run package` 產生正式 ZIP 後檢查權限和秘密掃描，再更新商店版本、權限說明、隱私 URL、說明／截圖與審查步驟。先讀取商店目前狀態，不推定先前申請已核准。

## 操作維護

- 暫停：設定 `SERVICE_ENABLED=false` 後部署；擴充功能會說明服務暫停並維持未檢查遮擋。
- 降低全站額度：`DAILY_LIMIT`、`MINUTE_LIMIT` 只能在目前上限內調低。調高須另做負載和成本評估。
- 重啟／部署不清空 D1，失敗分析仍計額。不可刪除 usage_events 當作解除限流的操作。
- API key 外洩：撤銷並更換後台秘密。SESSION_SECRET 外洩：輪替秘密，所有舊匿名 session 會失效並自動重取。
- 持續留意免費額度與匿名濫用；不啟用未經確認的付費方案、分析追蹤或新資料用途。
