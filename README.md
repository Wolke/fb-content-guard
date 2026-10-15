# 清朗 · FB 色情內容遮擋

Chrome 擴充功能，目標是安裝後同意分析就能使用，**不需要登入、API key、本機配對碼、Node.js 或終端機**。

**此分支為 0.2.0 雲端改版：程式與本機模擬驗證已完成，正式後台已部署但保持關閉，待設定 OpenAI key 與真實驗收，尚未取代商店的 0.1.0 本機版。請勿把開發包當作已上線產品。** 商店目前狀態須在控制台另外確認；這份 README 不代表新版已核准或發布。

## 新版使用方式（部署與商店更新完成後）

1. 安裝清朗。
2. 開啟設定，閱讀並同意將首頁貼文文字與圖片交由清朗雲端服務及 OpenAI 分析。
3. 儲存後重新整理 Facebook 首頁。

已辨識的貼文會先遮擋，未被模型標記後再顯示。疑似色情、影片、無法檢查或超過免費用量時保持遮擋，可以手動顯示。設定頁可關閉遮擋、撤回分析同意與檢查服務狀態。舊本機版的分析同意不會自動延用到雲端版。

## 功能範圍

- 僅桌面版 `www.facebook.com` 首頁 `/`、`/home.php`，不支援群組、個人頁、Messenger 或手機 App。
- 分析貼文容器的文字及已載入靜態 JPEG、PNG、WebP 圖片；影片、動畫及未展開內容保持遮擋。
- 每則最多 12 張圖片、16,000 文字字元。圖片下載上限 4 MiB，保留完整畫面縮至最長邊 512 像素的 JPEG；單張轉換後最多 128 KiB，合計 512 KiB。縮圖可能影響小字和細節的判斷，仍需真實驗收。
- 圖片下載限 HTTPS Facebook CDN，不攜帶 Cookie、不跟隨轉址。不擷取整頁截圖，也不點擊 Facebook 的隱藏或檢舉。
- Facebook 版面可能改動，模型可能誤判／漏檢。此工具不能保證阻擋全部色情內容，也不是無法繞過的家長監護工具。
- 模擬測試不代表真實 Facebook 適配或模型準確率已通過驗收。

## 資料與免費額度

資料流為擴充功能 → 清朗 HTTPS 雲端服務 → OpenAI Moderation。開發者在雲端保管 API key，終端使用者看不到，也不需申請金鑰。

使用者同意後才開始新的內容分析。服務不把貼文原文、圖片或原始網址寫入應用資料庫／日誌。為防止匿名濫用，後台使用短期匿名 session、當日 IP 派生碼及請求時間做限流。一般工作階段一小時到期；資料庫計數預定 48–49 小時內清除，平台備份另依平台政策。詳見 [雲端版政策草案](store/PRIVACY-CLOUD.md)。

目前預設：全站每日最多 1,000 次分析、每分鐘 15 次；單一網路來源每日 200 次／每分鐘 5 次；單一匿名 session 每日 100 次。失敗請求也計入已預留的分析額度。全站硬上限不能因重新安裝或後台重啟而歸零。

匿名限流不能完全阻止分散式濫用，遭濫用時可能耗盡免費額度而暫停服務。OpenAI 帳戶配額、Workers CPU／請求、D1 讀寫限制也可能更早到達。**不保證免費無限用量、不自動啟用付費方案或模型。**

## 開發者操作（一般使用者不需要執行）

需要 Node.js 22.13+、Python 3。首次安裝開發依賴：

```bash
npm ci
npm test
npm run test:runtime
npm run package:dev
```

`test:runtime` 在本機 Cloudflare workerd 和 D1 執行，所有 OpenAI 回應均為模擬。可選的 Chrome 合成測試：

```bash
npm install --no-save playwright
npx playwright install chromium
npm run test:browser
npm run test:images
```

`CHROME_PATH` 可指定獨立無頭 Chrome 執行檔；`PLAYWRIGHT_MODULE` 可指定既有 Playwright 模組檔案。

- [執行計畫](cloud/EXECUTION-PLAN.md)
- [後台架構與完成狀態](cloud/README.md)
- [免費部署操作手冊](cloud/DEPLOY.md)
- [正式部署進度](cloud/DEPLOYMENT-STATUS.md)
- [雲端版測試紀錄](cloud/TEST-REPORT.md)

部署完成後才由開發者執行：

```bash
python3 scripts/configure_cloud.py https://實際部署的主機名稱
npm run package
```

設定工具會檢查服務版本，再將固定主機加入最小權限。正式套件檢查會拒絕未配置的網址和 localhost 權限；開發包檔名／顯示名稱會標記勿上架。能打包不代表已通過真實驗收。

`server/` 保留 0.1.0 本機服務作回歸測試與開發參考，不屬於新版的使用流程。商店 ZIP 不包含伺服器原始碼、開發工具或秘密。
