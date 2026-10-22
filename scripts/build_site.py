"""Build the static site using the policy's Markdown as the single source."""
from pathlib import Path
import html
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs"


def inline(text):
    text = html.escape(text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    return re.sub(r"\[([^\]]+)\]\((https://[^)]+)\)", r'<a href="\2">\1</a>', text)


def policy_html(source="store/PRIVACY.md"):
    blocks = []
    for block in (ROOT / source).read_text().strip().split("\n\n"):
        if block.startswith("## "):
            blocks.append(f"<h2>{inline(block[3:])}</h2>")
        elif block.startswith("# "):
            blocks.append(f"<h1>{inline(block[2:])}</h1>")
        elif block.startswith("- "):
            blocks.append("<ul>" + "".join(f"<li>{inline(line[2:])}</li>" for line in block.splitlines()) + "</ul>")
        else:
            blocks.append(f"<p>{inline(block)}</p>")
    return "\n".join(blocks)


def page(title, description, content):
    return f'''<!doctype html>
<html lang="zh-Hant-TW">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="{html.escape(description, quote=True)}">
  <meta name="theme-color" content="#146a4c">
  <title>{html.escape(title)}</title>
  <link rel="icon" href="icon128.png" type="image/png">
  <link rel="stylesheet" href="site.css">
</head>
<body>
<a class="skip" href="#main">跳至主要內容</a>
<header><nav class="shell" aria-label="主要導覽">
  <a class="brand" href="./"><img src="icon128.png" alt="" width="38" height="38">清朗</a>
  <div class="navlinks"><a href="privacy.html">隱私權政策</a><a href="https://github.com/Wolke/fb-content-guard#readme">安裝說明</a><a href="https://github.com/Wolke/fb-content-guard/issues">問題回報</a></div>
</nav></header>
<main id="main" class="shell">{content}</main>
<footer><div class="shell">清朗 · FB 色情內容遮擋 · 開發者 Wolke<br>本產品不是 Meta、Facebook 或 OpenAI 的官方產品。</div></footer>
</body>
</html>
'''


OUT.mkdir(exist_ok=True)
shutil.copyfile(ROOT / "extension/icons/icon128.png", OUT / "icon128.png")
(OUT / ".nojekyll").touch()
(OUT / "privacy.html").write_text(page(
    "隱私權政策｜清朗 · FB 色情內容遮擋",
    "了解清朗如何處理 Facebook 貼文、使用 OpenAI 分類，以及儲存設定和撤回同意。",
    '<div class="eyebrow">PRIVACY / 資料與你的選擇</div><article>' + policy_html() + '</article>',
))
(OUT / "index.html").write_text(page(
    "清朗 · FB 色情內容遮擋",
    "先遮住 Facebook 首頁已辨識的貼文，再經使用者同意交由 OpenAI 分類的 Chrome 擴充功能。",
    '''<div class="eyebrow">清朗 / CHROME 擴充功能</div>
    <h1>滑動之前，<br>先檢查，再顯示貼文。</h1>
    <p class="lead">清朗會先遮住 Facebook 首頁已辨識的貼文，再經你的同意，將文字與靜態圖片交由 OpenAI 檢查色情內容。</p>
    <div class="actions"><a class="button" href="https://github.com/Wolke/fb-content-guard#readme">查看安裝說明</a><a class="button secondary" href="privacy-cloud.html">雲端版隱私權政策</a></div>
    <div class="note"><strong>0.2.0 雲端版已在 Chrome 商店公開。</strong><br>安裝、同意分析後即可使用，免登入、免配對碼，也不需要執行程式。0.2.1 改為檢查目前顯示的內容，並新增影片預覽檢查，已完成測試，尚未送審。</div>
    <h2>如何運作</h2>
    <ol><li>辨識 Facebook 首頁貼文，在檢查前先遮住內容。</li><li>經你同意後，由清朗雲端服務將貼文文字與縮小的靜態圖片送往 OpenAI。</li><li>未被模型標記的內容顯示；正式版直接隱藏尚未通過檢查的貼文，不顯示錯誤卡片。可從設定頁關閉遮擋。</li></ol>
    <h2>保留你的控制權</h2>
    <p>新版由開發者在後台保管 API key，不要求使用者提供。雲端服務會處理貼文，但不將原文或圖片存入應用資料庫。你可以撤回同意、停用或解除安裝。免費額度用完時會暫停分析；OpenAI 的資料處理依其 API 政策。</p>
    <h2>使用前請了解</h2>
    <p>目前只支援桌面版 Facebook 首頁。0.2.1 新增影片封面／單張畫面檢查，通過後顯示靜態預覽；整段影片尚未檢查，需手動播放。有「查看更多」或更多照片時，先檢查已載入的部分；展開後再檢查新增內容。Facebook 版面變動可能造成漏檢，模型也可能誤判；無法保證所有內容都能在出現前遮住。</p>
    <p>本版不會自動點擊 Facebook 的隱藏、檢舉或其他操作。完整功能限制與設定方式請參考 <a href="https://github.com/Wolke/fb-content-guard">公開原始碼與 README</a>。</p>''',
))
print("Built docs/index.html and docs/privacy.html")

(OUT / "privacy-cloud.html").write_text(page(
    "雲端版隱私權政策｜清朗",
    "清朗 0.2.x 雲端版的內容處理、免登入連線及用量資料說明。",
    '<div class="eyebrow">CLOUD PRIVACY / 雲端版隱私權政策</div><article>' + policy_html("store/PRIVACY-CLOUD.md") + '</article>',
))
