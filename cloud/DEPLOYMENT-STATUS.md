# 雲端部署狀態

查核日期：2026-10-15。版本：0.2.0。分支：cloud-migration。

## 已完成

- 使用者已授權官方 Wrangler 使用帳戶讀取、Workers Scripts Write、D1 Write；登入憑證採 Mac 鑰匙圈儲存。
- Cloudflare 控制台確認目前為 Workers Free（$0），含 D1 免費額度；未升級方案。
- 已部署 `fb-content-guard`：https://fb-content-guard.wolkesau.workers.dev 。
- 已建立 APAC 區域的專用 `fb-content-guard-usage` D1，套用 `0001_usage.sql`，唯讀查驗資料表及索引成功。
- 已設定隨機 `SESSION_SECRET`，直接傳入雲端秘密儲存，未輸出秘密值或加入 Git。
- 每小時第 17 分鐘執行清除排程。部署確認排程存在；尚未確認第一次排程執行結果。
- 公開 `/v1/health` 回應 HTTP 503 `SERVICE_NOT_CONFIGURED`，符合尚缺 OpenAI key 的狀態。首次讀取曾遇到部署傳播期間的 1042，稍後已正常到達應用程式。
- 控制台顯示 Logs／Traces／Issues 關閉。

## 目前停用狀態

`SERVICE_ENABLED=false`。`OPENAI_API_KEY` 尚待使用者直接填入控制台的 Secret 欄位。本機 `cloud/wrangler.local.jsonc` 包含部署資源識別碼且已被 Git 忽略；公開範例設定仍保持佔位值。

不得把此紀錄當作可供公眾使用的驗收證明。擴充功能尚未配置正式 API 網址；正式 ZIP 仍應拒絕產生。

## 後續

1. 確認 `OPENAI_API_KEY` 秘密已建立（僅查名稱，不讀取或記錄值）。
2. 確認專案 Moderation 限額，先用安全合成內容測試正式 Worker／D1／OpenAI；必要時調低全站額度。
3. 完成新版政策發布、雲端版同意與實際 Facebook／Chrome 驗收，查看免費 CPU 使用及清除排程結果。
4. 配置正式主機權限、打包、秘密掃描及更新 Chrome Web Store。

截至本紀錄，GitHub Pages 新政策及商店新版尚未發布；舊套件尚未替換。
