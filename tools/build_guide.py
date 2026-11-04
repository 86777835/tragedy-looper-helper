# Builds public/guide.html (rules guide + FAQ) from the guide script and the FAQ list.
# Usage: python3 tools/build_guide.py tools/讲解稿.md public/guide.html tools/faq.json
# 讲解稿.md: one section per "## title", bullets as points.
import re, html, sys, json
src, out, faq_src = sys.argv[1], sys.argv[2], sys.argv[3]
SRC = {
    'rb': ('规则书', 'https://main-bakafire.ssl-lolipop.jp/rooper/10th/quickset.html'),
    'faq': ('官方 FAQ', 'https://bakafire.main.jp/rooper/sr_game_02_rule.htm'),
    'faq5': ('5th 剧作家之书 FAQ（BGG 英译）', 'https://boardgamegeek.com/thread/2326691'),
    'dev': ('设计者 BakaFire 的回答（atwiki 收录）', 'https://w.atwiki.jp/rooper/pages/21.html'),
}
faq = json.load(open(faq_src))
cats = list(dict.fromkeys(f['cat'] for f in faq))
faq_html = ''.join(f'<h3 class="fq-cat">{html.escape(c)}</h3>' + ''.join(
    f'<details class="card fq"><summary>{html.escape(f["q"])}</summary><p>{html.escape(f["a"])} <a href="{SRC[f["src"]][1]}" target="_blank" rel="noopener">来源：{SRC[f["src"]][0]}{html.escape(f.get("ref", ""))}</a></p></details>'
    for f in faq if f['cat'] == c) for c in cats)
secs = re.findall(r'^## (.+?)\n(.*?)(?=^## |\Z)', open(src).read(), re.M | re.S)
toc = '<a class="fqa" href="#faq">常见问题</a>' + ''.join(f'<a href="#s{i}">{html.escape(t)}</a>' for i, (t, _) in enumerate(secs, 1))
body = ''
for i, (t, b) in enumerate(secs, 1):
    pts = ''.join(f'<li>{html.escape(x)}</li>' for x in re.findall(r'^- (.+)$', b, re.M))
    body += f'''<section class="card gs" id="s{i}"><h2 class="h"><span><i>{i:02d}</i>{html.escape(t)}</span></h2><ul>{pts}</ul></section>\n'''
open(out, 'w').write(f'''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#110d16">
<title>规则介绍 · 惨剧轮回剧作家助手</title>
<meta property="og:title" content="规则介绍 · 惨剧轮回剧作家助手">
<meta property="og:image" content="https://tl.leisurecat.cloud/img/icon-512.jpg">
<link rel="icon" href="img/icon-64.png">
<link rel="apple-touch-icon" href="img/icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600&family=Noto+Serif+SC:wght@600;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css">
</head>
<body>
<div style="position:absolute;width:0;height:0;overflow:hidden"><img src="img/icon-512.jpg" alt=""></div>
<div class="hero-art" style="height:calc(env(safe-area-inset-top) + 190px)"><a class="nav-back" href="/" data-html2canvas-ignore>‹ 返回</a><img src="img/guide.jpg" alt="" style="object-position:50% 50%"><div class="ht"><div class="hz">规则介绍</div><div class="hs">惨剧轮回 · 5th 基础规则</div></div></div>
<div class="wrap guide">
<p class="note">依据官方规则书《主人公の書》（5th）和官方速查表整理，用自己的话概括，页码是规则书印刷页码。这一页不含任何剧本内容，主人公也可以看。</p>
<h2 class="h"><span>规则讲解</span><small>{len(secs)} 节</small></h2>
<nav class="toc">{toc}</nav>
{body}<h2 class="h" id="faq"><span>常见问题</span><small>{len(faq)} 条</small></h2>
<p class="note">依据官方规则书、官方 FAQ 和官方速查表整理，点开查看答案。官网 FAQ 是旧版（Χ）时期发布的，只收录 5th 规则没有改动的条目；部分条目来自设计者在推特上的回答（atwiki 收录）。</p>
{faq_html}
<a class="btn" href="./">返回首页</a>
<footer>非官方玩家工具 · 规则依据《惨剧RoopeR 5th》官方资料</footer>
</div>
<script type="module" src="chat.js"></script>
</body>
</html>
''')
print(len(secs), len(faq))
