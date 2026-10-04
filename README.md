# 清朗 · FB 色情內容遮擋

個人使用的 Chrome Manifest V3 擴充功能，搭配只監聽 `127.0.0.1:43187` 的本機 Node.js 服務。先遮住貼文，再以 OpenAI `omni-moderation-latest` 檢查文字與靜態圖片。

GitHub 儲存庫：`Wolke/fb-content-guard`。Chrome Web Store 尚未上架。

**目前是原型，尚未使用你的 FB 帳號和真實 API key 驗收。測試中的分類結果為模擬，不代表模型的實際準確率。**

## 安裝（第一次）

需要桌面版 Chrome、Node.js 22 或更新版本，以及 OpenAI API key。執行 `node --version` 可確認 Node 版本。執行時不需要安裝 npm 套件。

1. 在 Terminal 切換到這份 README 所在的 `fb-content-guard` 資料夾。
2. 執行：

   ```bash
   npm run setup
   ```

   依提示輸入 API key；輸入過程不會顯示金鑰。程式會建立只有本機帳號能讀寫的 `server/.env`，並顯示一組**本機配對碼**。請先複製配對碼。不要將 API key 貼到聊天或擴充功能。

   想先測試介面，可以按 Enter 跳過金鑰；這時服務可連線，但不會放行未檢查貼文。之後重新執行 setup 會重設金鑰及配對碼。

3. 啟動服務，讓此 Terminal 持續開著：

   ```bash
   npm start
   ```

4. 在 Chrome 網址列輸入 `chrome://extensions`，開啟「開發人員模式」，點選「載入未封裝項目」，選擇本資料夾內的 **`extension`** 資料夾。
5. 點擊工具列的「清朗」圖示，貼上**本機配對碼**，閱讀並勾選傳送貼文分析的同意選項，再按「儲存設定」。
6. 點「檢查本機服務」，確認已連線且 API key 已設定。這項檢查不會呼叫 OpenAI，不能驗證金鑰是否有效。
7. 開啟或重新整理 `https://www.facebook.com/`。若是安裝前已開啟的分頁，必須重新整理。

macOS 也可使用 `setup.command` 與 `start.command`；若系統不允許雙擊執行，請直接使用上述 Terminal 指令。

## 日常使用

- 保持 `npm start` 的 Terminal 開啟。`Ctrl+C` 停止服務。
- 擴充功能的開關可以暫停遮擋；開關儲存後會通知已開啟的 FB 分頁。
- 「正在檢查」：貼文先遮住，優先處理目前畫面及下方約 1,200 像素內的貼文，單分頁最多同時檢查 2 則。
- 「已隱藏：疑似色情」：內容在本機收合，點「顯示此貼文」可展開。
- 「尚未通過檢查」：讀圖失敗、服務未啟動、API 錯誤、未展開的內容或不支援的媒體。可重試，或自行決定顯示。
- 「未被模型標記」只代表這次檢查結果，不是安全保證。誤判時可以手動展開。
- 若 FB 在同一個頁面元素換入不同內容，會撤銷舊的放行或手動展開狀態，重新檢查。
- 不會自動按 FB 的「隱藏貼文」、按讚、檢舉或發送訊息。

## 支援範圍與限制

- 僅 `www.facebook.com` 首頁 `/`、`/home.php`。其他 FB 頁面、群組、個人頁、Messenger、手機 App 不在此版範圍。
- 偵測 `[role="article"]` 與 `FeedUnit_` 結構。FB 可能改版或對不同帳號提供不同版面，未辨識的區塊可能無法遮擋。彈出設定會顯示辨識數量；在有貼文的畫面上持續顯示 0，需要調整選擇器。
- 僅文字和已載入的 JPEG、PNG、WebP 靜態圖片。GIF、偵測到的動畫、影片、Reels、canvas、iframe、未支援的媒體來源會保持遮擋，不會自動當作安全內容。
- 圖片只允許 HTTPS `*.fbcdn.net` 來源，下載不攜帶 FB Cookie、不跟隨轉址。遇到需要額外驗證的圖片會失敗並保持遮擋。
- 每則最多 12 個圖片元素（包含頭像）、單圖 4 MiB、合計 12 MiB，文字最多 16,000 字元。超過限制不截斷放行。
- 已辨識的「查看更多」或多圖 `+N` 會保留遮罩；不會自動點開。未載入的內容無法分析，未辨識的特殊版型仍可能漏檢。
- `sexual` 與文字的 `sexual/minors` 標記用於遮擋；不會因其他類別如暴力的 `flagged` 值而擋住。此版沒有「嚴格擦邊」分類器。
- Moderation 不是兒少性虐待影像辨識工具；不要刻意提交已知或疑似此類素材作為測試資料。官方說明：https://developers.openai.com/api/docs/guides/moderation
- 初始 CSS 與 DOM 變更監聽用來降低閃現，但尚不能保證所有 FB 版面與快速捲動情境都零閃現。
- 此工具不是無法繞過的家長監護工具；使用者可關閉擴充功能或手動顯示內容。

## 資料、權限與成本

- 擴充功能取得貼文容器內的文字（可能包含作者、載入的留言與介面文字）及圖片（包含頭像），經本機服務傳給 OpenAI。沒有傳送整頁截圖、Cookie 或登入密碼。
- `storage` 用於啟用設定、同意選項和本機配對碼。配對碼只在可信任的擴充功能頁面與背景服務可讀取。
- FB 權限用於讀取與修改首頁 DOM；`fbcdn.net` 權限用於讀圖；`127.0.0.1` 權限用於連線固定本機服務。Chrome 的主機權限顯示可能涵蓋此主機所有連接埠，程式只呼叫 43187。
- 原文、圖片與 API key 不寫入應用程式日誌；快取只在分頁記憶體保存最近 300 筆 SHA-256 內容識別與判斷。重新整理或離開首頁時快取清除。OpenAI 端的資料处理依其 API 資料政策，不代表零留存：https://developers.openai.com/api/docs/guides/your-data
- API key 僅保存在本機 `server/.env`，不要分享此檔。配對碼不是 OpenAI key，但仍應保密。
- Moderation API 目前免費且有速率限制。模型、價格和政策可能改變，以官方文件為準。
- 預設每日最多 2,000 次 API 嘗試，可在 `.env` 調整 `FG_DAILY_LIMIT` 後重啟。計數在 UTC 午夜重設，也會在服務重啟時歸零；這是單次服務的流量保護，不是持久的帳單上限。失敗的 API 嘗試也计數。

## 測試與開發

```bash
npm test
```

核心測試涵蓋分類格式、全圖提交、金鑰缺失、配對、來源/Host 限制、流量限制、CDN 來源白名單與錯誤時保持遮擋。

可選的瀏覽器測試需要 Playwright：

```bash
npm install --no-save playwright
npx playwright install chromium
npm run test:browser
```

瀏覽器測試只使用合成的 FB 類似結構與模擬 API 結果，不讀取帳號，也不呼叫 OpenAI。`CHROME_PATH` 可指定現有 Chrome 執行檔；`PLAYWRIGHT_MODULE` 可指定已安裝的 Playwright 模組路徑。實際結果見 `TEST-REPORT.md`。

程式結構：

```text
extension/manifest.json   Chrome 權限與載入設定
extension/content.js      貼文辨識、遮罩、排程、內容更新與快取
extension/background.js   配對設定、跨來源讀圖、本機服務呼叫
extension/net.js          圖片來源與大小限制
extension/popup.*         設定與狀態介面
server/setup.mjs          本機金鑰與配對碼初始化
server/app.mjs            本機 HTTP 驗證與流量限制
server/moderation.mjs     OpenAI Moderation 整合
tests/                    模擬測試
```

要更新擴充功能：修改檔案後在 `chrome://extensions` 點「重新載入」，再重新整理 FB。

## Chrome Web Store 打包

```bash
npm run package
```

產生 `dist/fb-content-guard-chrome-0.1.0.zip`，根目錄直接包含 manifest.json，且不含本機服務、金鑰或測試檔。GitHub Actions 也會測試並產出同樣的套件。

商店文案及權限說明見 `store/LISTING.md`，隱私權政策見 `store/PRIVACY.md`，圖示與商店素材已包含在專案。這些是申請準備資料，不代表開發者註冊、正式送審或公開發布已完成。
