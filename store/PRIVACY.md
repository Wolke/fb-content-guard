# 清朗 · FB 色情內容遮擋 — 隱私權政策

更新日期：2026-10-04。適用版本：0.1.0。

清朗的單一用途，是在桌面版 Facebook 首頁先遮住已辨識的貼文，經使用者同意送交 OpenAI 色情內容分類後，顯示或繼續遮擋內容。本產品不是 Meta、Facebook 或 OpenAI 的官方產品。

## 處理的資料與用途

使用者啟用且同意分析後，擴充功能會讀取目前 Facebook 首頁貼文容器內的文字與已載入圖片。這可能包含貼文內容、作者名稱、頭像、已載入的留言、介面文字，以及圖片中可見的個人資訊。貼文本身也可能含健康、財務、付款、位置資訊或個人通訊的截圖；程式不會先剔除這些內容。這些資料僅用於色情內容檢查，不用來建立個人敏感資料檔案。

圖片來源網址用於從 Facebook 的圖片 CDN 下載圖檔。程式不攜帶 Facebook Cookie 進行此下載。下載的圖檔內容與貼文文字，經使用者電腦上的本機服務送至 OpenAI Moderation API。本機服務只監聽 127.0.0.1，與 OpenAI 的連線使用 HTTPS。

程式不擷取整頁截圖、不讀取瀏覽器歷史紀錄資料庫、不取得 Facebook 密碼或 Cookie。為辨識貼文及處理首頁導覽，程式會在記憶體中讀取目前頁面網址及貼文內部分連結。

## 儲存與保留

- 啟用開關、使用者同意選項與本機配對碼儲存在 Chrome 擴充功能的本機儲存空間，不使用 Chrome 同步儲存。
- OpenAI API key 由使用者輸入並儲存在自己的電腦 `server/.env`，不放在擴充功能，也不傳送給本產品開發者。
- 原文與圖片會在處理時暫存於程式記憶體；程式不將其寫入應用程式日誌或持久資料庫。圖片下載要求使用 no-store。
- 分頁記憶體最多保存 300 筆內容識別雜湊與分類結果，重新整理或切換網址時清除。本機服務的呼叫計數只保存在記憶體。
- Facebook、Chrome 與作業系統自身的資料儲存，不由本擴充功能控制。

## 接收方

只有 OpenAI API 會接收用於分類的貼文文字與圖檔。本產品開發者不營運接收這些資料的中央伺服器，也不內建廣告、追蹤或分析 SDK。OpenAI 的資料處理和保留依使用者的 API 帳戶設定及其 [API 資料政策](https://developers.openai.com/api/docs/guides/your-data)；此產品不承諾 OpenAI 端零留存。

我們不出售使用者資料，也不將這些資料用於廣告、信用評估或與色情內容檢查無關的目的。資料的使用與傳輸遵守 Chrome Web Store User Data Policy，包括 Limited Use 的限制。

## 使用者控制

使用者可以在設定中撤回分析同意、關閉遮擋，或解除安裝擴充功能。撤回同意後不再開始新的分析；已傳出的要求可能仍由 OpenAI 完成。每則貼文可由使用者手動顯示。

解除安裝擴充功能會移除其本機設定；本機服務及 `server/.env` 需要由使用者另外刪除。請勿公開 `.env` 或分享配對碼。若擔心 API key 外洩，可在 OpenAI 帳戶撤銷該金鑰。

## 聯絡方式

開發者：Wolke。一般隱私權問題可透過 [GitHub Issues](https://github.com/Wolke/fb-content-guard/issues) 提出；該頁為公開空間，請勿附上金鑰、私人貼文、圖片或其他個人資料。

## 本網站

本說明網站由 GitHub Pages 託管，沒有加入分析工具、廣告、Cookie 或追蹤程式。造訪網站時，GitHub 的託管服務適用其 [隱私權聲明](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)。網站本身不會讀取 Facebook 貼文，也不會呼叫 OpenAI。
