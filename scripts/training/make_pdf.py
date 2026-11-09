import json, subprocess, io, sys
import requests
from PIL import Image
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Image as RLImage,
                                Table, TableStyle, KeepTogether, PageBreak, Flowable)

def font(q):
    return subprocess.check_output(["fc-match", "-f", "%{file}", q], text=True).strip()
pdfmetrics.registerFont(TTFont("NS", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"))
pdfmetrics.registerFont(TTFont("NSB", "/usr/share/fonts/truetype/LiberationSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("NSS", "/usr/share/fonts/truetype/LiberationSans-Bold.ttf"))
from reportlab.pdfbase.pdfmetrics import registerFontFamily
registerFontFamily("NS", normal="NS", bold="NSB", italic="NS", boldItalic="NSB")

BRAND = colors.HexColor("#1C9BCB")
BRAND_SOFT = colors.HexColor("#E6F5FB")
INK = colors.HexColor("#22201C")
MUTED = colors.HexColor("#6B655C")
CLAY = colors.HexColor("#F6F1EA")
LINE = colors.HexColor("#E3DCD1")

DATA = json.load(open("/dev-server/src/lib/cleaner-training.json"))
ASSETS = "/dev-server/src/assets/training"

logo_bytes = requests.get("http://localhost:8080/__l5e/assets-v1/428e6e79-d003-4bab-9d5e-c6fc74498350/wrrcs-logo.png", timeout=30).content
logo = Image.open(io.BytesIO(logo_bytes)).convert("RGBA")
bg = Image.new("RGBA", logo.size, (255, 255, 255, 255)); bg.alpha_composite(logo)
bg.convert("RGB").save("/tmp/training/logo.png")

def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

S = {
    "title": ParagraphStyle("title", fontName="NSB", fontSize=28, leading=34, textColor=INK, spaceAfter=10),
    "sub": ParagraphStyle("sub", fontName="NS", fontSize=14, leading=20, textColor=MUTED, spaceAfter=18),
    "note": ParagraphStyle("note", fontName="NS", fontSize=10, leading=14, textColor=MUTED),
    "toc": ParagraphStyle("toc", fontName="NS", fontSize=11.5, leading=18, textColor=INK),
    "tochead": ParagraphStyle("tochead", fontName="NSB", fontSize=12, leading=16, textColor=BRAND, spaceAfter=6),
    "h": ParagraphStyle("h", fontName="NSB", fontSize=18, leading=23, textColor=INK),
    "intro": ParagraphStyle("intro", fontName="NS", fontSize=11.5, leading=16.5, textColor=INK, spaceBefore=8, spaceAfter=8),
    "step": ParagraphStyle("step", fontName="NS", fontSize=11, leading=15.5, textColor=INK),
    "num": ParagraphStyle("num", fontName="NSB", fontSize=10, leading=15.5, textColor=BRAND, alignment=1),
    "tip": ParagraphStyle("tip", fontName="NS", fontSize=10.5, leading=15, textColor=INK),
    "foot": ParagraphStyle("foot", fontName="NS", fontSize=8.5, leading=10, textColor=MUTED),
}

class Rule(Flowable):
    def __init__(self, w): super().__init__(); self.w = w; self.height = 6
    def wrap(self, *a): return self.w, self.height
    def draw(self):
        self.canv.setStrokeColor(LINE); self.canv.setLineWidth(0.8); self.canv.line(0, 3, self.w, 3)

def badge(n):
    t = Table([[Paragraph(f"<font color='white'>{n}</font>", ParagraphStyle("b", fontName="NSB", fontSize=13, leading=16, alignment=1))]],
              colWidths=[0.42 * inch], rowHeights=[0.42 * inch])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), BRAND), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                           ("ROUNDEDCORNERS", [10, 10, 10, 10]), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    return t

def build(lang, out):
    g = DATA[lang]
    W, H = letter
    M = 0.75 * inch
    CW = W - 2 * M

    def on_page(c, doc):
        c.saveState()
        c.setFont("NS", 8.5); c.setFillColor(MUTED)
        c.drawString(M, 0.45 * inch, g["title"])
        c.drawRightString(W - M, 0.45 * inch, str(doc.page))
        c.setStrokeColor(LINE); c.line(M, 0.62 * inch, W - M, 0.62 * inch)
        c.restoreState()

    def on_cover(c, doc):
        c.saveState()
        c.setFillColor(BRAND); c.rect(0, H - 0.35 * inch, W, 0.35 * inch, stroke=0, fill=1)
        c.restoreState()

    doc = BaseDocTemplate(out, pagesize=letter, leftMargin=M, rightMargin=M, topMargin=M, bottomMargin=0.85 * inch,
                          title=g["title"], author="Wash Rinse Repeat Cleaning Services", subject=g["subtitle"])
    frame = Frame(M, 0.85 * inch, CW, H - M - 0.85 * inch, id="f", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id="cover", frames=[frame], onPage=on_cover), PageTemplate(id="body", frames=[frame], onPage=on_page)])

    story = []
    lw = 3.2 * inch; li = Image.open("/tmp/training/logo.png")
    story += [Spacer(1, 0.5 * inch), RLImage("/tmp/training/logo.png", width=lw, height=lw * li.height / li.width), Spacer(1, 0.45 * inch)]
    story += [Paragraph(esc(g["title"]), S["title"]), Paragraph(esc(g["subtitle"]), S["sub"])]
    nt = Table([[Paragraph(esc(g["sampleNote"]), S["note"])]], colWidths=[CW])
    nt.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), CLAY), ("ROUNDEDCORNERS", [8, 8, 8, 8]),
                            ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                            ("TOPPADDING", (0, 0), (-1, -1), 9), ("BOTTOMPADDING", (0, 0), (-1, -1), 9)]))
    story += [nt, Spacer(1, 0.35 * inch), Paragraph(esc(g["contentsLabel"]).upper(), S["tochead"])]
    secs = g["sections"]
    half = (len(secs) + 1) // 2
    rows = []
    for i in range(half):
        a = Paragraph(f"<font color='#1C9BCB'><font name='NSB'>{i+1}.</font></font> {esc(secs[i]['title'])}", S["toc"])
        j = i + half
        b = Paragraph(f"<font color='#1C9BCB'><font name='NSB'>{j+1}.</font></font> {esc(secs[j]['title'])}", S["toc"]) if j < len(secs) else ""
        rows.append([a, b])
    tt = Table(rows, colWidths=[CW / 2, CW / 2])
    tt.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    story += [tt]
    from reportlab.platypus import NextPageTemplate
    story += [NextPageTemplate("body"), PageBreak()]

    for i, s in enumerate(secs):
        head = Table([[badge(i + 1), Paragraph(esc(s["title"]), S["h"])]], colWidths=[0.58 * inch, CW - 0.58 * inch])
        head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
        text = [head, Paragraph(esc(s["intro"]), S["intro"])]
        srows = [[Paragraph(f"{k+1}", S["num"]), Paragraph(esc(st), S["step"])] for k, st in enumerate(s["steps"])]
        imgs = [f"{ASSETS}/{lang}-{key}.jpg" for key in s["images"]]
        img_w = 2.35 * inch if len(imgs) <= 1 else 2.25 * inch
        text_w = CW - (img_w + 0.3 * inch) * (1 if len(imgs) == 1 else 0)
        st = Table(srows, colWidths=[0.32 * inch, text_w - 0.32 * inch])
        st.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                                ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))
        body = [st]
        if s.get("tip"):
            tip = Table([[Paragraph(f"<font name='NSB'>{esc(g['tipLabel'])}:</font> {esc(s['tip'])}", S["tip"])]], colWidths=[text_w])
            tip.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), BRAND_SOFT), ("LINEBEFORE", (0, 0), (0, -1), 3, BRAND),
                                     ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                                     ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
            body += [Spacer(1, 8), tip]

        def pic(p):
            im = Image.open(p); h = img_w * im.height / im.width
            t = Table([[RLImage(p, width=img_w, height=h)]], colWidths=[img_w])
            t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.8, LINE), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                                   ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
            return t

        block = list(text)
        if len(imgs) == 1:
            two = Table([[body, pic(imgs[0])]], colWidths=[text_w, CW - text_w])
            two.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("ALIGN", (1, 0), (1, 0), "RIGHT")]))
            block.append(two)
        else:
            block += body
            if imgs:
                row = Table([[pic(p) for p in imgs]], colWidths=[CW / len(imgs)] * len(imgs))
                row.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER"), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
                block += [Spacer(1, 12), row]
        block += [Spacer(1, 14), Rule(CW), Spacer(1, 14)]
        story.append(KeepTogether(block))
    doc.build(story)
    print("built", out)

for lang, out in [("en", sys.argv[1]), ("uk", sys.argv[2])]:
    build(lang, out)
