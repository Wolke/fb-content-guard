# 免安裝本機服務的改版工作區

日期：2026-10-15。狀態：開發中，尚未部署，也尚未替換商店套件。

使用者已選定：所有人可安裝、不需要登入。不要求消費者輸入 API key、配對碼、下載原始碼、安裝 Node.js 或執行 npm。

## 目標使用流程

1. 從商店安裝擴充功能。
2. 看到清楚的資料用途說明，主動同意把貼文文字與圖片送往本服務及 OpenAI 分類。
3. 啟用遮擋，重新整理 Facebook 首頁即可使用。
4. 未同意時不送出內容；額度用完或服務失敗時顯示原因，未檢查內容保持遮擋，允許手動顯示。

GitHub Pages 繼續負責介紹和隱私權政策。分析流向是：擴充功能 → HTTPS 後台 → OpenAI Moderation。OpenAI key 只放在後台的秘密設定，不能寫進擴充功能、GitHub 或 Pages。

## 免費部署方案比較（待選擇）

- **GitHub Pages**：靜態網頁，不提供代為保管金鑰並執行分類 API 的伺服器功能。可繼續作產品網站。
- **Google Apps Script**：可作後台，部署者執行、匿名使用者存取的設定需要在實際帳戶確認。一般帳戶 URL Fetch 配額目前為每日 20,000 次，且有每使用者同時執行 30 次等限制。共用部署者額度，不是每位訪客都有一份。回應有 Google 網域重新導向，必須測試擴充功能請求和權限；不能直接部署目前的 Node/Web Request 程式。
- **Cloudflare Workers Free**：目前每日 100,000 個請求、單次 10ms CPU；可搭配免費 D1 儲存少量用量計數。推薦作公開 API 的候選，仍須以真實圖片大小驗證 CPU／記憶體限制，不能把請求額度當成可服務人數。
- **OpenAI Moderation**：模型目前免費，但帳戶仍有速率和用量限制，部署前以實際專案為準。最先到達的任一平台限制決定服務容量。

沒有啟用任何付費方案，沒有承諾免費額度可無限供應。若免費額度不足，先限制或暫停分析，不自動升級／改呼叫付費模型。

## 免登入的防濫用設計

使用者不需要帳號。可由擴充功能自動取得短期匿名工作階段，無需手動輸入任何代碼。這只是限流輔助，不能當作已辨識真實使用者；重新安裝、換 IP 或自行呼叫 API 都可能繞過單裝置限制。

所以必須有持久、原子的全站上限和全站速率限制；匿名 session／IP 限制只作第二層保護。CORS 和 extension ID 都不是身分驗證，不能防止外部程式模仿請求。匿名 session 的簽發本身也必須有限流，必要的防機器人介面另行討論，不擅自改成登入流程。

原文與圖片只在分析時處理，不寫進資料庫或應用日誌；若採用 IP 派生識別碼／匿名 session 計數，須明定保存期限、清除工作及隱私揭露。平台自身連線紀錄仍依平台政策。舊版「開發者不營運接收資料的伺服器」聲明，在雲端版啟用前必須更新並重新取得同意。

## 已完成的基礎程式

`handler.mjs` 是候選後台的請求處理核心：固定分析路徑、HTTPS、來源檢查、匿名 session 驗證介面、限制大小的串流讀取、有效負載檢查、先預留額度再呼叫 API、隱藏內部錯誤。七個模擬測試通過。

**目前沒有 session 簽發／驗證實作、持久限額實作、平台入口或正式網址，不能直接作公開服務。** 擴充功能仍是舊版，尚未連接這個核心。session 和配額在測試中是替身，測試不代表已解決匿名濫用。核心目前沿用含 Node Buffer 的驗證器，Workers 需確認 Node 相容性；GAS 需另外做介接。

## 接續修改與驗收

1. 選免費後台；使用專案擁有者帳戶建立隔離服務，確認免費方案與實際配額。
2. 在後台秘密設定中加入專用 OpenAI key。不要把 key 貼進聊天或原始碼。
3. 實作匿名 session 簽發、持久全站限制、網路層限流、短期計數與清除；驗證多個執行個體和重啟不能重置上限。
4. 修改 manifest 的固定 HTTPS 主機權限，移除 localhost；改寫 background 的配對流程與 popup，移除本機配對碼、npm 指示及金鑰欄位。
5. 保留先遮擋、失敗不放行、手動顯示功能。只分析已載入靜態圖片與文字，不在這次加入詐騙或影片分類。
6. 真實 Chrome＋Facebook 驗證：未同意不傳內容、同意後可分類、撤回同意、快速滑動、網路中斷、多圖、免費額度耗盡、重新安裝及服務重啟。
7. 更新隱私政策／同意版本、商店權限理由／測試說明／截圖。先確認商店當前狀態，再以新版本號上傳更新；不可只改 UI 卻把舊 localhost 套件重新送審。

## 待討論與需提供的資源

- 後台選 Cloudflare 免費帳戶或現有 Google 帳戶的 GAS；不需要每位終端使用者註冊。
- 一個由專案擁有者管理的 OpenAI API 專案與金鑰，只在正式部署時設進秘密欄位。
- 免費額度耗盡時的產品文案與預設全站／每裝置上限；以測量結果提出具體數值。
- 發布前要完成以上真實驗收；本分支準備工作不代表雲端版已完成。

## 官方來源（查核日期 2026-10-15）

- [GitHub Pages 靜態網站服務](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [GAS Web Apps](https://developers.google.com/apps-script/guides/web)
- [GAS 配額](https://developers.google.com/apps-script/guides/services/quotas)
- [GAS Content Service 轉址](https://developers.google.com/apps-script/guides/content)
- [Workers 定價與免費額度](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 免費額度](https://developers.cloudflare.com/d1/platform/pricing/)
- [OpenAI Moderation 模型與限額](https://developers.openai.com/api/docs/models/omni-moderation-latest)
