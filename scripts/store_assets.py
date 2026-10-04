"""Render code-drawn shield icons and store preview assets (Pillow required)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import argparse

parser = argparse.ArgumentParser()
parser.add_argument('--font', required=True, help='Path to a Traditional Chinese font')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
icons = root / 'extension/icons'
assets = root / 'store/assets'
icons.mkdir(parents=True, exist_ok=True)
assets.mkdir(parents=True, exist_ok=True)

im = Image.new('RGBA', (512, 512))
d = ImageDraw.Draw(im)
d.rounded_rectangle((64, 64, 448, 448), 90, fill='#216652')
d.polygon([(256, 130), (358, 171), (348, 280), (315, 337), (256, 377), (197, 337), (164, 280), (154, 171)], fill='#f0faf4')
d.line([(209, 252), (244, 287), (310, 218)], fill='#216652', width=26, joint='curve')
for size in [16, 32, 48, 128]:
    im.resize((size, size), Image.Resampling.LANCZOS).save(icons / f'icon{size}.png')

promo = Image.new('RGB', (880, 560), '#f3f7f4')
promo.paste(im.resize((210, 210)), (55, 72), im.resize((210, 210)))
p = ImageDraw.Draw(promo)
font = lambda size: ImageFont.truetype(args.font, size)
p.text((292, 93), '清朗', font=font(76), fill='#214e3e')
p.text((295, 194), 'FB 色情內容遮擋', font=font(29), fill='#456556')
p.text((95, 336), '先遮住，檢查後再顯示。', font=font(40), fill='#214e3e')
p.text((95, 426), '需搭配本機服務與自己的 OpenAI API key', font=font(25), fill='#60776d')
promo.resize((440, 280), Image.Resampling.LANCZOS).save(assets / 'promo-440x280.png')

preview = root / 'test-results/preview.png'
if preview.exists():
    shot = Image.open(preview).convert('RGB')
    shot.thumbnail((1040, 760), Image.Resampling.LANCZOS)
    canvas = Image.new('RGB', (1280, 800), '#e9efeb')
    canvas.paste(shot, ((1280-shot.width)//2, (800-shot.height)//2))
    canvas.save(assets / 'screenshot-1280x800.png')
print('Store images generated.')
