# Chrome Web Store 提交資料

## 名稱
清朗 · FB 色情內容遮擋

## 短說明
先遮住 FB 首頁貼文，再透過本機服務與 OpenAI 檢查色情內容。個人測試版。

## 詳細說明
清朗會先遮住已辨識的 Facebook 首頁貼文，在你同意後，將文字與靜態圖片經本機服務送交 OpenAI 檢查色情內容。未被分類為色情的貼文會顯示；疑似色情內容會收合，並保留手動顯示按鈕。

使用前需要：桌面版 Chrome、Node.js 22 或更新版本、自己提供的 OpenAI API key，以及在自己的電腦持續執行本機服務。單獨安裝擴充功能尚無法完成分析。

功能：
- 檢查前先遮住貼文。
- 分析已載入的文字與 JPEG、PNG、WebP 靜態圖片。
- 提供手動顯示、重試及啟用開關。
- 圖片無法讀取或檢查失敗時維持遮擋。
- 不會替你按 FB 隱藏、檢舉或按讚。

資料說明：同意後，貼文容器內的文字與圖片（可能包括作者名稱、頭像與已載入的留言）會經本機服務送至 OpenAI。API key 保存在自己的電腦，程式不將原文或圖片寫入日誌。

支援範圍：桌面版 www.facebook.com 首頁。影片、Reels、限時動態、群組與手機 App 不在此版本範圍。可能誤判、漏檢或受 Facebook 版面變更影響；不保證完全阻擋色情，也不是無法繞過的家長監護工具。本產品與 Meta、Facebook、OpenAI 無官方隸屬關係。

## 隱私權分頁填寫草稿

單一用途：在桌面版 Facebook 首頁，依色情內容分類結果遮擋或顯示已辨識的貼文。

權限理由：
- storage：保存啟用狀態、分析同意與本機配對碼。
- https://www.facebook.com/*：讀取首頁貼文、在頁面加入遮罩、同步設定至 FB 分頁；不讀取其他網站。
- https://*.fbcdn.net/*：下載貼文中已載入的圖片供分類，不攜帶 Facebook Cookie。
- http://127.0.0.1/*：只連線使用者本機的 43187 連接埠，由本機服務保管 API key 並呼叫 OpenAI。

遠端程式碼：沒有。所有執行的 JavaScript 隨擴充功能打包，OpenAI 回傳 JSON 分類而非可執行程式碼。

資料揭露時不可勾選「不蒐集或使用任何資料」。實際處理包含 Website content，內容也可能含 Personally identifiable information、Personal communications 及 Health information 等敏感資訊；本機配對碼屬 Authentication information。依控制台当时各欄位定義如實填寫，不能只因不寫入開發者伺服器而不揭露。

## 測試人員說明草稿

此版需要本機 Node.js 服務及 OpenAI API key。請依 README 啟動服務、在擴充功能設定填入本機配對碼並同意送出內容分析，然後重新整理 Facebook 首頁。未設定金鑰時會保持遮擋，這不是正常分析流程。

提交前必須提供審查人員可以取得的本機服務下載網址和可行的測試方式。不可在公開商店說明放入自己的 API key。當前版本尚未完成真實 FB + OpenAI 端到端驗收，這一點必須在正式提交前處理。

## 素材

- extension/icons/icon128.png：128×128 商店圖示。
- store/assets/promo-440x280.png：小型宣傳圖。
- store/assets/screenshot-1280x800.png：合成測試介面示意，畫面明確標示非實際 FB。
- dist/fb-content-guard-chrome-0.1.0.zip：只包含擴充功能，manifest 位於根目錄。

目前草稿設定為不公開列出的測試版本。開發者帳戶已註冊，隱私權政策、首頁、支援網址與測試操作說明均已在控制台儲存；仍待資料使用承諾確認與真實端到端驗收。最新狀態見 `SUBMISSION-STATUS.md`。

- 首頁：https://wolke.github.io/fb-content-guard/
- 隱私權政策：https://wolke.github.io/fb-content-guard/privacy.html
- 支援：https://github.com/Wolke/fb-content-guard/issues
