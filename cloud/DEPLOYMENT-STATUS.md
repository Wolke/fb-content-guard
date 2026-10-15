# 雲端部署狀態

查核日期：2026-10-15。版本：0.2.0。

- Cloudflare Workers Free 與 D1 Free；沒有升級付費方案。
- 正式服務：https://fb-content-guard.wolkesau.workers.dev ，`SERVICE_ENABLED=true`。
- OpenAI key 由使用者直接設定為 Secret；另有隨機 SESSION_SECRET，未加入 Git 或套件。
- D1 已套用資料表及索引；每小時第 17 分鐘執行清除排程。排程已部署，實際排程執行結果尚未取得。
- `/v1/health`、匿名連線、真實安全文字、單圖及雙圖分類皆成功。雙圖測試約 1.35 秒；不是容量或準確率保證。
- 真實 API 拒絕多張圖片放入同一次請求，已改為逐張圖片搭配貼文文字檢查；每張各計一次額度。所有圖片通過才放行。
- 全站每日 1,000、每分鐘 15 次分類；單一網路每日 200、每分鐘 15 次；session 每日 100 次。整則貼文需要的額度一次原子預留；失敗或提前遮擋不退額度。
- Logs／Traces／Issues 關閉。控制台 CPU 圖表目前顯示 No data，尚無實際 CPU 分布可作容量結論。
- 新政策已公開：https://wolke.github.io/fb-content-guard/privacy-cloud.html 。舊版本政策保留。
- 已配置正式 HTTPS 主機與商店相同 extension ID。正式 ZIP 不含 API key、後台程式或 localhost 權限。

Chrome Web Store 目前公開版本仍為 0.1.0；0.2.0 更新準備中。雲端部署成功不等於商店已核准新版。
