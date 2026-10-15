# 免安裝本機服務的改版工作區

日期：2026-10-15。狀態：Worker／D1 已啟用；真實 API 與 Facebook 貼文分類已通過。0.2.0 商店套件已上傳，商店資料更新中，尚未送審。

使用者已選定：所有人可安裝、不需要登入。不要求消費者輸入 API key、配對碼、下載原始碼、安裝 Node.js 或執行 npm。

## 目標使用流程

1. 從商店安裝擴充功能。
2. 看到清楚的資料用途說明，主動同意把貼文文字與圖片送往本服務及 OpenAI 分類。
3. 啟用遮擋，重新整理 Facebook 首頁即可使用。
4. 未同意時不送出內容；額度用完或服務失敗時顯示原因，未檢查內容保持遮擋，允許手動顯示。

GitHub Pages 繼續負責介紹和隱私權政策。分析流向是：擴充功能 → HTTPS 後台 → OpenAI Moderation。OpenAI key 只放在後台的秘密設定，不能寫進擴充功能、GitHub 或 Pages。

## 免費部署方案比較（已採 Cloudflare）

- **GitHub Pages**：靜態網頁，不提供代為保管金鑰並執行分類 API 的伺服器功能。可繼續作產品網站。
- **Google Apps Script**：可作後台，部署者執行、匿名使用者存取的設定需要在實際帳戶確認。一般帳戶 URL Fetch 配額目前為每日 20,000 次，且有每使用者同時執行 30 次等限制。共用部署者額度，不是每位訪客都有一份。回應有 Google 網域重新導向，必須測試擴充功能請求和權限；不能直接部署目前的 Node/Web Request 程式。
- **Cloudflare Workers Free**：目前每日 100,000 個請求、單次 10ms CPU；可搭配免費 D1 儲存少量用量計數。已採用作公開 API 的實作目標，仍須以真實圖片大小驗證 CPU／記憶體限制，不能把請求額度當成可服務人數。
- **OpenAI Moderation**：模型目前免費，但帳戶仍有速率和用量限制，部署前以實際專案為準。最先到達的任一平台限制決定服務容量。

沒有啟用任何付費方案，沒有承諾免費額度可無限供應。若免費額度不足，先限制或暫停分析，不自動升級／改呼叫付費模型。

## 免登入的防濫用設計

使用者不需要帳號。可由擴充功能自動取得短期匿名工作階段，無需手動輸入任何代碼。這只是限流輔助，不能當作已辨識真實使用者；重新安裝、換 IP 或自行呼叫 API 都可能繞過單裝置限制。

所以必須有持久、原子的全站上限和全站速率限制；匿名 session／IP 限制只作第二層保護。CORS 和 extension ID 都不是身分驗證，不能防止外部程式模仿請求。匿名 session 的簽發本身也必須有限流，必要的防機器人介面另行討論，不擅自改成登入流程。

原文與圖片只在分析時處理，不寫進資料庫或應用日誌；IP 派生識別碼／匿名 session 計數的主要資料保存 48–49 小時，並已加入清除排程與隱私揭露。平台自身連線紀錄仍依平台政策。舊版「開發者不營運接收資料的伺服器」聲明，在雲端版啟用前必須更新並重新取得同意。

## 已部署的程式

- `worker.mjs`／`entry.mjs`：Workers HTTP 入口、服務開關、匿名 session 簽發、清除排程。
- `security.mjs`：HMAC 簽章、有效期限、extension audience 和當日 IP 派生碼驗證，不需要登入。
- `quota.mjs`／`migrations/`：D1 單一條件 INSERT 原子預留額度，涵蓋全站、網路來源及 session，失敗分析也計額。
- `handler.mjs`：限制大小和讀取時間的請求、伺服器端圖片上限、固定分類端點及錯誤時不放行。
- `extension/` 已移除配對與 localhost，採自動匿名連線、雲端版同意、錯誤暫停及完整畫面縮圖。先前同意不會沿用。
- 部署配置預設關閉；正式包要求有效 HTTPS 部署網址，開發包明確標示勿上架。

Cloudflare 帳戶授權、部署及金鑰設定已完成，詳見 [部署進度](DEPLOYMENT-STATUS.md) 與 [測試紀錄](TEST-REPORT.md)。真實 API 與已登入 Facebook 貼文皆已完成基本驗收；尚未完成系統性準確率、快速滑動漏檢和容量評測。

## 部署切換與驗收清單

1. 已採 Cloudflare 免費方案作實作目標；使用專案擁有者帳戶建立隔離服務，確認免費方案與實際配額。
2. 在後台秘密設定中加入專用 OpenAI key。不要把 key 貼進聊天或原始碼。
3. 實作匿名 session 簽發、持久全站限制、網路層限流、短期計數與清除；驗證多個執行個體和重啟不能重置上限。
4. 修改 manifest 的固定 HTTPS 主機權限，移除 localhost；改寫 background 的配對流程與 popup，移除本機配對碼、npm 指示及金鑰欄位。
5. 保留先遮擋、失敗不放行、手動顯示功能。只分析已載入靜態圖片與文字，不在這次加入詐騙或影片分類。
6. 真實 Chrome＋Facebook 驗證：未同意不傳內容、同意後可分類、撤回同意、快速滑動、網路中斷、多圖、免費額度耗盡、重新安裝及服務重啟。
7. 更新隱私政策／同意版本、商店權限理由／測試說明／截圖。先確認商店當前狀態，再以新版本號上傳更新；不可只改 UI 卻把舊 localhost 套件重新送審。

## 維運資源與限制

- 已使用專案擁有者的 Cloudflare 免費帳戶部署；不需要每位終端使用者註冊。
- OpenAI API key 已由專案擁有者在 Cloudflare Secret 設定。
- 已設全站每日最多 1,000 次、每分鐘 15 次圖片／文字分類（多圖每張計一次），另有 IP 與 session 限流；正式驗收後可調低。額度耗盡時保持遮擋並允許手動顯示。
- 商店新版尚待送審；後台已可用不代表 Google 已核准。

## 官方來源（查核日期 2026-10-15）

- [GitHub Pages 靜態網站服務](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [GAS Web Apps](https://developers.google.com/apps-script/guides/web)
- [GAS 配額](https://developers.google.com/apps-script/guides/services/quotas)
- [GAS Content Service 轉址](https://developers.google.com/apps-script/guides/content)
- [Workers 定價與免費額度](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 免費額度](https://developers.cloudflare.com/d1/platform/pricing/)
- [OpenAI Moderation 模型與限額](https://developers.openai.com/api/docs/models/omni-moderation-latest)
