"""Builds the short first-day guides (one PDF per language) from cleaner-training.json.
Usage: python3 make_first_day_pdf.py <out-en.pdf> <out-uk.pdf>   (dev server must be running for the logo)"""
import json, io, sys
import requests
from PIL import Image
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Image as RLImage,
                                Table, TableStyle, KeepTogether, PageBreak, NextPageTemplate)

pdfmetrics.registerFont(TTFont("NS", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"))
pdfmetrics.registerFont(TTFont("NSB", "/usr/share/fonts/truetype/LiberationSans-Bold.ttf"))
registerFontFamily("NS", normal="NS", bold="NSB", italic="NS", boldItalic="NSB")

BRAND = colors.HexColor("#1C9BCB"); BRAND_SOFT = colors.HexColor("#E6F5FB")
INK = colors.HexColor("#22201C"); MUTED = colors.HexColor("#6B655C")
CLAY = colors.HexColor("#F6F1EA"); LINE = colors.HexColor("#E3DCD1")

DATA = json.load(open("/dev-server/src/lib/cleaner-training.json"))
ASSETS = "/dev-server/src/assets/training"
LOGO = "/tmp/training/logo.png"

logo_bytes = requests.get("http://localhost:8080/__l5e/assets-v1/428e6e79-d003-4bab-9d5e-c6fc74498350/wrrcs-logo.png", timeout=30).content
logo = Image.open(io.BytesIO(logo_bytes)).convert("RGBA")
bg = Image.new("RGBA", logo.size, (255, 255, 255, 255)); bg.alpha_composite(logo); bg.convert("RGB").save(LOGO)

def esc(s): return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

S = {
    "title": ParagraphStyle("title", fontName="NSB", fontSize=26, leading=31, textColor=INK, spaceAfter=6),
    "sub": ParagraphStyle("sub", fontName="NS", fontSize=14, leading=19, textColor=BRAND, spaceAfter=12),
    "intro": ParagraphStyle("intro", fontName="NS", fontSize=12, leading=17, textColor=INK),
    "boxhead": ParagraphStyle("bh", fontName="NSB", fontSize=12.5, leading=16, textColor=INK, spaceAfter=4),
    "boxline": ParagraphStyle("bl", fontName="NS", fontSize=11.5, leading=16, textColor=INK),
    "note": ParagraphStyle("note", fontName="NS", fontSize=9.5, leading=13, textColor=MUTED),
    "toc": ParagraphStyle("toc", fontName="NS", fontSize=11.5, leading=17, textColor=INK),
    "kicker": ParagraphStyle("k", fontName="NSB", fontSize=10, leading=12, textColor=BRAND),
    "h": ParagraphStyle("h", fontName="NSB", fontSize=17, leading=21, textColor=INK, spaceAfter=8),
    "line": ParagraphStyle("line", fontName="NS", fontSize=12, leading=16.5, textColor=INK),
    "dot": ParagraphStyle("dot", fontName="NSB", fontSize=12, leading=16.5, textColor=BRAND),
}

def pad(t, bgc, l=14, tp=10):
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), bgc), ("ROUNDEDCORNERS", [10, 10, 10, 10]),
                           ("LEFTPADDING", (0, 0), (-1, -1), l), ("RIGHTPADDING", (0, 0), (-1, -1), l),
                           ("TOPPADDING", (0, 0), (-1, -1), tp), ("BOTTOMPADDING", (0, 0), (-1, -1), tp), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    return t

def badge(n):
    t = Table([[Paragraph(f"<font color='white'>{n}</font>", ParagraphStyle("b", fontName="NSB", fontSize=16, leading=19, alignment=1))]],
              colWidths=[0.5 * inch], rowHeights=[0.5 * inch])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), BRAND), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                           ("ROUNDEDCORNERS", [12, 12, 12, 12]), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    return t

def bullets(items, w, mark="•"):
    t = Table([[Paragraph(mark, S["dot"]), Paragraph(esc(x), S["boxline"])] for x in items], colWidths=[0.22 * inch, w - 0.22 * inch])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                           ("TOPPADDING", (0, 0), (-1, -1), 1.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5)]))
    return t

def build(lang, out):
    g = DATA[lang]; f = g["firstDay"]
    W, H = letter; M = 0.7 * inch; CW = W - 2 * M

    def on_page(c, doc):
        c.saveState(); c.setFillColor(BRAND); c.rect(0, H - 0.22 * inch, W, 0.22 * inch, stroke=0, fill=1)
        c.setFont("NS", 8.5); c.setFillColor(MUTED)
        c.drawString(M, 0.42 * inch, f["title"]); c.drawRightString(W - M, 0.42 * inch, str(doc.page))
        c.setStrokeColor(LINE); c.line(M, 0.6 * inch, W - M, 0.6 * inch); c.restoreState()

    doc = BaseDocTemplate(out, pagesize=letter, leftMargin=M, rightMargin=M, topMargin=0.6 * inch, bottomMargin=0.8 * inch,
                          title=f["title"], author="Wash Rinse Repeat Cleaning Services", subject=f["subtitle"])
    frame = Frame(M, 0.8 * inch, CW, H - 0.6 * inch - 0.8 * inch, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id="p", frames=[frame], onPage=on_page)])

    story = []
    li = Image.open(LOGO); lw = 2.6 * inch
    story += [Spacer(1, 0.2 * inch), RLImage(LOGO, width=lw, height=lw * li.height / li.width, hAlign="LEFT"), Spacer(1, 0.3 * inch)]
    story += [Paragraph(esc(f["title"]), S["title"]), Paragraph(esc(f["subtitle"]), S["sub"]), Paragraph(esc(f["intro"]), S["intro"]), Spacer(1, 16)]
    half = (CW - 12) / 2
    before = pad(Table([[[Paragraph(esc(f["beforeTitle"]), S["boxhead"]), bullets(f["before"], half - 28, "•")]]], colWidths=[half]), BRAND_SOFT)
    rem = pad(Table([[[Paragraph(esc(f["rememberTitle"]), S["boxhead"]), bullets(f["remember"], half - 28, "!")]]], colWidths=[half]), CLAY)
    two = Table([[before, rem]], colWidths=[half + 6, half + 6])
    two.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    story += [two, Spacer(1, 18)]
    rows = []; steps = f["steps"]; hs = (len(steps) + 1) // 2
    for i in range(hs):
        cell = lambda j: Paragraph(f"<font name='NSB' color='#1C9BCB'>{j+1}.</font> {esc(steps[j]['title'])}", S["toc"]) if j < len(steps) else ""
        rows.append([cell(i), cell(i + hs)])
    toc = Table(rows, colWidths=[CW / 2, CW / 2])
    toc.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
    story += [toc, Spacer(1, 14), Paragraph(esc(g["sampleNote"]), S["note"]), PageBreak()]

    IMG_W = 2.05 * inch
    for i, s in enumerate(steps):
        p = f"{ASSETS}/{lang}-{s['image']}.jpg"
        im = Image.open(p); ih = IMG_W * im.height / im.width
        pic = Table([[RLImage(p, width=IMG_W, height=ih)]], colWidths=[IMG_W])
        pic.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.8, LINE), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                 ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
        tw = CW - IMG_W - 0.35 * inch - 0.66 * inch
        lines = Table([[Paragraph(f"{k+1}", S["dot"]), Paragraph(esc(x), S["line"])] for k, x in enumerate(s["lines"])], colWidths=[0.26 * inch, tw - 0.26 * inch])
        lines.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                   ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]))
        text = [Paragraph(f"{esc(f['stepWord']).upper()} {i+1} / {len(steps)}", S["kicker"]), Spacer(1, 3), Paragraph(esc(s["title"]), S["h"]), lines]
        row = Table([[badge(i + 1), text, pic]], colWidths=[0.66 * inch, tw + 0.2 * inch, IMG_W + 0.15 * inch])
        row.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                 ("ALIGN", (2, 0), (2, 0), "RIGHT"), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
        story.append(KeepTogether([row]))
        if i % 2 == 0:
            story += [Spacer(1, 10), Table([[""]], colWidths=[CW], rowHeights=[1], style=[("LINEABOVE", (0, 0), (-1, -1), 0.8, LINE)]), Spacer(1, 10)]
        elif i < len(steps) - 1:
            story.append(PageBreak())
    doc.build(story)
    print("built", out)

build("en", sys.argv[1]); build("uk", sys.argv[2])
