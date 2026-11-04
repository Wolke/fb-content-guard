# Chrome Web Store 申請進度

最新更新：2026-11-04。0.2.4 程式、套件與送審資料已準備並推送，公開隱私政策已更新，完整 CI 通過。

- [版本與驗證紀錄](RELEASE-0.2.4.md)
- [完整 CI：51 項程式、32 項瀏覽器情境及 Worker/D1 全部成功](https://github.com/Wolke/fb-content-guard/actions/runs/41792579968)
- [公開政策](https://wolke.github.io/fb-content-guard/privacy-cloud.html) 已包含本機 Gemini Nano 實驗功能，HTTP 200 且與來源內容一致。
- 套件：dist/fb-content-guard-chrome-0.2.4.zip。
- **尚未上傳 0.2.4，尚未送出審查。** Chrome 已停在 Google 密碼金鑰身分驗證頁，等待發布者本人驗證。
- 已請使用者載入本機 0.2.4；真實 Facebook → 雲端 → 擴充功能模型分頁的端到端驗收仍待完成。
- 使用者已授權完成剩餘驗證、公開程式／政策更新及送審，不需再次詢問送審意願。

## 先前紀錄（非目前狀態）

最新更新：2026-11-03。0.2.3 已完成程式、測試、正式 ZIP 與送審欄位準備；本回合沒有 Chrome 控制工具，尚未上傳或提交，也未查核商店目前狀態。詳見 [0.2.3 更新紀錄](RELEASE-0.2.3.md)。

最後已驗證提交（2026-10-29）：0.2.1 正式版已提交審查，控制台顯示「待審查」與「你已將擴充功能提交審查」。核准後自動公開，既有公開版為 0.2.0。詳見 [0.2.1 更新紀錄](RELEASE-0.2.1.md) 與 [雲端版送審資料](LISTING-CLOUD.md)。

2026-11-03 送審準備確認：

- 0.2.3 與相關文件已合併並推送 main（4d2a5bd）。
- [公開政策](https://wolke.github.io/fb-content-guard/privacy-cloud.html) 已確認包含右側廣告及排程說明；[Pages 部署](https://github.com/Wolke/fb-content-guard/actions/runs/41610166914) 成功。
- [main 分支 CI](https://github.com/Wolke/fb-content-guard/actions/runs/41610167787) 的邏輯、Worker／D1、打包與瀏覽器測試全部成功。
- 正式套件：dist/fb-content-guard-chrome-0.2.3.zip；SHA-256：c49ba269e677cf3ae1a733bcf63f148305e7364d771f4638bbad9b9a957162ab。已確認版本與來源一致、未含 development 標記。
- 商品說明、單一用途、權限理由與審查操作說明在 LISTING-CLOUD.md；尚未填入商店控制台。
- 使用者已授權送審，無須再次確認。阻礙是本回合沒有可控制 Chrome 的工具，並非等待使用者批准。商店開啟請求僅回覆 queued，不代表頁面已載入或完成登入。
- **尚未上傳 0.2.3、尚未送出審查、尚未確認商店最新狀態。**

以下保留 2026-10-04 的 0.1.0 歷史紀錄，並非目前狀態。

- GitHub： https://github.com/Wolke/fb-content-guard （已公開）
- 產品網站：https://wolke.github.io/fb-content-guard/
- 隱私權政策：https://wolke.github.io/fb-content-guard/privacy.html
- Chrome 開發者帳戶已註冊，未產生新的註冊費。
- 新項目名稱：清朗 · FB 色情內容遮擋
- Extension ID：`pgncaeldodjlhkgmkknppnjephnnoobf`
- 控制台：https://chrome.google.com/webstore/devconsole/4a44e1a6-8e2a-438c-9f7f-e4188f074bec/pgncaeldodjlhkgmkknppnjephnnoobf/edit
- 目前狀態：已提交，控制台顯示「待審查」；尚未核准或發布。
- 發布方式：通過審查後手動發布。控制台提示暫存商品須在核准後 30 天內發布，否則失效。

已上傳版本 0.1.0 的擴充功能 ZIP；已填寫中文（台灣）商品說明、工具類別，並上傳圖示、合成測試介面截圖與小型宣傳圖塊。已填寫單一用途、storage／網站存取權限理由，以及不使用遠端程式碼。

發布草稿設定為免費、不公開列出（只有知道連結的人可找到）；尚未實際發布。已儲存本機服務設定及測試步驟，更新為公開原始碼連結，並明確註明端到端驗收尚待完成。

已在控制台儲存隱私權政策 URL、首頁網址與 GitHub Issues 支援網址。GitHub Pages 從 `main:/docs` 發布，已確認首頁和政策頁回傳 HTTP 200，且內容與專案產物完全一致。網站部署及專案測試／打包 CI 均成功。

經發布者明確確認，三項資料使用承諾已勾選並儲存，並依後續指示提交版本 0.1.0。控制台顯示「你已將擴充功能提交審查」及「已提交商品」，項目狀態為「待審查」。提交前取消勾選自動發布，保留核准後手動發布。真實 Facebook／OpenAI 端到端驗收尚未完成，審查操作說明中保留了此項限制，未宣稱測試通過。

資料類型採保守揭露：網站內容、個人識別資訊、驗證資訊，以及貼文可能包含的健康、財務和付款、個人通訊、位置資訊。沒有收集瀏覽歷史資料庫或建立使用者活動記錄。

待完成：

- 真實 Chrome 未封裝安裝、Facebook 頁面及 OpenAI API 端到端驗收。
- 等待 Google 審查結果，必要時依回覆補充測試方式或修正。
- 核准後完成上架前驗收，再於核准後 30 天內手動發布；提交不等於通過審查。
