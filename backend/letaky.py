"""Letáky pro obce na nástěnku (PDF): lékaři v dosahu veřejné dopravy, kteří přijímají nové pacienty.

data_letaku() spočítá obsah (spoje z hlavní zastávky obce k lékařům ze seznamu kraje „nabírá“ + nejbližší
praktik a zubař), vytvor_pdf() z něj udělá A4 velkým písmem v barvách Dojedeme (design/BRAND.md).
Vpravo dole vedle patičky je QR kód na web (vnouče nebo sociální pracovník si spoj najde v telefonu).
Používá /obce/{kod}/lekari (JSON pro web) a /letaky/{kod}.pdf.
"""
import io
import re
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

import pandas as pd
import segno
from fpdf import FPDF
from fpdf.fonts import FontFace

from routing import Router, fmt, haversine_m

FONTY = Path(__file__).resolve().parents[1] / "design" / "fonts"
LIMIT_MIN = 120                   # do letáku jen lékaři, ke kterým se dá dojet do 2 h
NA_LETAKU = 10                    # na papír nejvýš 10 nejbližších pracovišť (JSON má všechna)
# web /aplikace zatím neumí předvyplnit obec ani bydliště z adresy (hash nese jen cíl) → obecný odkaz
ODKAZ_QR = "https://dojedeme.cz/aplikace"
QR_MM = 30                        # strana QR kódu i s bílým okrajem (modul asi 0,9 mm – telefon ho načte i z metru)
QR_MEZERA = 6                     # mezera mezi textem (a patičkou) vlevo a QR kódem vpravo
PATA_MM = 14                      # patička začíná 14 mm nad spodním okrajem stránky
UPOZORNENI = "Údaj ze seznamu Karlovarského kraje z 11. 4. 2022 – před návštěvou zavolejte."
DNY = ["pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota", "neděle"]

# barvy z design/tokens.json (světlý režim – tisk)
PRIMARY, ON_PRIMARY, INK, INK2 = (20, 87, 74), (255, 255, 255), (17, 26, 23), (62, 74, 69)
WARNING, WARNING_BG = (94, 59, 0), (253, 240, 210)
SIGNAL_TINT, PRIMARY_TINT, BORDER = (253, 242, 216), (227, 241, 236), (201, 210, 206)


def txt(v) -> str | None:
    """Text, nebo None (prázdné hodnoty z pandas jsou NaN a JSON je neumí)."""
    return v if isinstance(v, str) and v and v != "nan" else None


def telefon_cz(t: str) -> str:
    c = t.replace("+420", "").replace(" ", "")
    return f"{c[0:3]} {c[3:6]} {c[6:9]}" if len(c) == 9 else t


def prestupy_slovy(n: int) -> str:
    return "bez přestupu" if n == 0 else "1 přestup" if n == 1 else f"{n} přestupy" if n < 5 else f"{n} přestupů"


def typicky_den(dnes: date | None = None) -> date:
    """Nejbližší úterý (běžný pracovní den, kdy ordinují lékaři) – spoje na letáku platí pro pracovní dny."""
    dnes = dnes or date.today()
    return dnes + timedelta(days=(1 - dnes.weekday()) % 7 or 7)


def data_letaku(kod: str, router: Router, cile: pd.DataFrame, obce: pd.DataFrame, hlavni: pd.DataFrame,
                senior_expres: list[dict], typy: dict, lekari_jmena: dict, cislo_sluzby: str | None) -> dict:
    o = obce[obce["kod_obce"] == kod]
    if o.empty:
        raise KeyError(kod)
    o = o.iloc[0]
    hz = hlavni[hlavni["kod_obce"] == kod]
    hz = hz.iloc[0] if not hz.empty else None
    if hz is not None and pd.notna(hz["lat"]):
        start, zastavka = (float(hz["lat"]), float(hz["lon"])), hz["zastavka"]
    else:
        start, zastavka = (float(o["stred_lat"]), float(o["stred_lon"])), None
    den = typicky_den()

    def dostupnost(df: pd.DataFrame) -> pd.DataFrame:
        df = df.assign(vzdusne_km=haversine_m(start[0], start[1], df["lat"].values, df["lon"].values) / 1000)
        df = df[df["vzdusne_km"] <= 45]
        if df.empty:
            return df.assign(cesta_min=pd.Series(dtype=float))
        d = df.join(router.dostupnost_cilu(start, df, den, 6 * 60))
        d["cesta_min"] = d["prijezd_min"] - d["odjezd_min"]
        return d[d["prijezd_min"].notna() & (d["cesta_min"] <= LIMIT_MIN)].sort_values(["cesta_min", "vzdusne_km"])

    def polozka(r) -> dict:
        return {"id": r["id"], "typ": r["typ"], "typ_nazev": typy.get(r["typ"], r["typ"]), "nazev": r["nazev"],
                "lekari": txt(lekari_jmena.get(str(r["id"]).removeprefix("lek-"))), "adresa": txt(r["adresa"]),
                "obec": txt(r["obec"]),
                "telefon": [p for p in (txt(r["telefon"]) or "").split(";") if p],
                "cesta_min": int(r["cesta_min"]), "pesky": r["pesky"] is True,
                "zastavka": txt(r["zastavka"]),
                "odjezd": txt(r["odjezd_spoje"]) or fmt(int(r["odjezd_min"])),
                "prijezd": fmt(int(r["prijezd_min"])),
                "prestupy": int(r["prestupy"]), "vzdusne_km": round(float(r["vzdusne_km"]), 1)}

    nabira = dostupnost(cile[cile["nabira"].astype(str) == "True"]).drop_duplicates("id")
    pocty = {}
    for t in nabira["typ"]:
        pocty[typy.get(t, t)] = pocty.get(typy.get(t, t), 0) + 1
    # jedno pracoviště s víc obory (např. poliklinika) = jedna položka se seznamem oborů
    seznam = []
    for _, skupina in nabira.groupby(nabira["id"].str.rsplit("-", n=1).str[0], sort=False):
        p = polozka(skupina.iloc[0])
        if len(skupina) > 1:
            p["typ_nazev"] = ", ".join(typy.get(t, t) for t in skupina["typ"])
            p["typy"] = list(skupina["typ"])
            p["lekari"] = None
        seznam.append(p)
    seznam.sort(key=lambda p: (p["cesta_min"], p["vzdusne_km"]))
    nejblizsi = []
    for typ in ("praktik", "zubar"):
        d = dostupnost(cile[cile["typ"] == typ])
        # přednost mají ordinace s telefonem – na nástěnce je řádek bez telefonu k ničemu
        d = d.assign(_bez_tel=d["telefon"].map(lambda t: txt(t) is None)).sort_values(["_bez_tel", "cesta_min", "vzdusne_km"],
                                                                                      kind="stable")
        nejblizsi += [polozka(r) for _, r in d.head(2).iterrows()]
    return {"kod_obce": kod, "obec": o["nazev"], "zastavka": zastavka, "datum": den.isoformat(),
            "den": f"{DNY[den.weekday()]} {den.day}. {den.month}. {den.year}", "limit_min": LIMIT_MIN,
            "nabira": seznam, "pocet_nabira": len(seznam), "pocty": pocty, "nejblizsi": nejblizsi,
            "senior_expres": senior_expres, "cislo_sluzby": cislo_sluzby,
            "upozorneni": UPOZORNENI, "nabira_k_datu": "2022-04-11"}


def _jmena(s: str | None) -> str | None:
    """„MUDr. Zdeněk Hess MUDr. Vladimír Kadlec“ → „MUDr. Zdeněk Hess, MUDr. Vladimír Kadlec“."""
    if not s:
        return None
    s = re.sub(r"(?<=[^\s,])\s+(?=(?:MUDr|MDDr|Mgr|Bc|PhDr|doc|prof)\.)", ", ", s.strip())
    return re.sub(r"\s*,\s*", ", ", s)


def _zastavka(s: str | None) -> str:
    """„Teplá,nám.“ → „Teplá, nám.“ (v jízdních řádech chybí za čárkou mezera)."""
    return re.sub(r",(?=\S)", ", ", s or "")


def _md(s: str) -> str:
    """Text do buňky tabulky s markdownem – zneškodní značky ** -- __."""
    return (s or "").replace("**", "*").replace("--", "–").replace("__", "_")


class _Letak(FPDF):
    def __init__(self, obec: str, vygenerovano: str):
        super().__init__(format="A4")
        self.obec, self.vygenerovano = obec, vygenerovano
        self.add_font("Sans", "", str(FONTY / "SourceSans3-Regular.ttf"))
        self.add_font("Sans", "B", str(FONTY / "SourceSans3-Bold.ttf"))
        self.add_font("SansSB", "", str(FONTY / "SourceSans3-Semibold.ttf"))
        self.set_margins(14, 14, 14)
        self.set_auto_page_break(True, margin=18)
        self.set_title(f"Lékaři, kteří přijímají nové pacienty – {obec}")
        self.set_author("Dojedeme – dojedeme.cz")
        self.qr_strana = None   # na které straně je QR kód (patička tam uhne doleva)

    def multi_cell(self, *args, align="L", **kwargs):
        # zarovnání do bloku dělá u krátkých řádků velké mezery – senioři čtou lépe text zarovnaný vlevo
        return super().multi_cell(*args, align=align, **kwargs)

    def footer(self):
        self.set_y(-PATA_MM)
        self.set_font("Sans", "", 8.5)
        self.set_text_color(*INK2)
        strana = f" Strana {self.page_no()}." if self.page_no() > 1 else ""
        sirka = self.w - self.l_margin - self.r_margin - (QR_MM + QR_MEZERA if self.page_no() == self.qr_strana else 0)
        self.multi_cell(sirka, 3.8, "Zdroje: otevřená data Karlovarského kraje (DATA ZÁPAD), registr poskytovatelů zdravotních "
                                    f"služeb (ÚZIS), jízdní řády CIS JŘ. Vytvořeno {self.vygenerovano}. "
                                    f"Letáky dalších obcí: dojedeme.cz/pro-obce.{strana}")


def _box(pdf: FPDF, barva_pozadi, nadpis: str, text: str):
    """Barevný rámeček (odvoz pro seniory, SMS služba) – nadpis tučně, pod ním text."""
    sirka = pdf.w - pdf.l_margin - pdf.r_margin
    pdf.set_font("Sans", "", 11)
    radku = len(pdf.multi_cell(sirka - 10, 5, text, dry_run=True, output="LINES"))
    vyska = 7 + 5.6 + radku * 5
    if pdf.get_y() + vyska > pdf.h - pdf.b_margin:
        pdf.add_page()
    x, y = pdf.l_margin, pdf.get_y()
    pdf.set_fill_color(*barva_pozadi)
    pdf.rect(x, y, sirka, vyska, style="F", round_corners=True, corner_radius=2.5)
    pdf.set_xy(x + 5, y + 3.5)
    pdf.set_text_color(*INK)
    pdf.set_font("Sans", "B", 12)
    pdf.cell(sirka - 10, 5.6, nadpis, new_x="LMARGIN", new_y="NEXT")
    pdf.set_x(x + 5)
    pdf.set_font("Sans", "", 11)
    pdf.multi_cell(sirka - 10, 5, text, new_x="LMARGIN", new_y="NEXT")
    pdf.set_xy(x, y + vyska + 3)


@lru_cache(maxsize=4)
def _qr_png(odkaz: str) -> bytes:
    """QR kód jako PNG (segno, čistý Python). Bílý okraj 2 moduly, dál je bílý papír (tichá zóna je dost velká)."""
    buf = io.BytesIO()
    segno.make(odkaz, error="m", micro=False).save(buf, kind="png", scale=16, border=2, dark=INK, light=(255, 255, 255))
    return buf.getvalue()


def _qr(pdf: _Letak):
    """QR kód na web vpravo dole vedle patičky, nad patičkou vlevo krátký text. QR sdílí výšku s patičkou, takže
    z obsahu ubere jen asi 2 cm. Když se pod obsah nevejde, přidá stranu (vytvor_pdf pak ubere lékaře)."""
    sirka_textu = pdf.w - pdf.l_margin - pdf.r_margin - QR_MM - QR_MEZERA
    nadpis = "Spoje k lékaři a zpátky najdete na dojedeme.cz"
    text = ("Načtěte kód fotoaparátem telefonu. Zadáte, odkud a kam jedete, a uvidíte spoj tam "
            "i poslední spoj domů. Pomoci vám může i někdo z rodiny nebo sociální pracovník.")
    # jednopísmenné předložky a spojky na konci řádku nenechávat (nezlomitelná mezera)
    nadpis, text = (re.sub(r"(?<!\S)([aikosuvzAIKOSUVZ]) ", "\\1\u00a0", s) for s in (nadpis, text))
    pdf.set_font("Sans", "B", 14)
    n1 = len(pdf.multi_cell(sirka_textu, 6.4, nadpis, dry_run=True, output="LINES"))
    pdf.set_font("Sans", "", 11)
    n2 = len(pdf.multi_cell(sirka_textu, 5.2, text, dry_run=True, output="LINES"))
    vyska_textu = n1 * 6.4 + 1.5 + n2 * 5.2
    qr_y = pdf.h - PATA_MM + 2 * 3.8 - QR_MM          # spodek QR v úrovni posledního řádku patičky (2 řádky)
    y = min(qr_y, pdf.h - PATA_MM - 2.5 - vyska_textu)  # text nesmí sjet do patičky
    if pdf.get_y() + 2 > y:
        pdf.add_page()
    pdf.qr_strana = pdf.page_no()
    x_qr = pdf.w - pdf.r_margin - QR_MM
    pdf.image(io.BytesIO(_qr_png(ODKAZ_QR)), x=x_qr, y=qr_y, w=QR_MM, h=QR_MM, link=ODKAZ_QR,
              alt_text="QR kód s odkazem na dojedeme.cz/aplikace")
    pdf.set_xy(pdf.l_margin, y)
    pdf.set_text_color(*INK)
    pdf.set_font("Sans", "B", 14)
    pdf.multi_cell(sirka_textu, 6.4, nadpis, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1.5)
    pdf.set_text_color(*INK2)
    pdf.set_font("Sans", "", 11)
    pdf.multi_cell(sirka_textu, 5.2, text, new_x="LMARGIN", new_y="NEXT")
    pdf.link(pdf.l_margin, y, sirka_textu, n1 * 6.4, ODKAZ_QR)   # v PDF na obrazovce se dá kliknout i na nadpis


def _tabulka(pdf: FPDF, lekari: list[dict], zastavka: str | None):
    """Lékař a adresa | telefon – jeden řádek na pracoviště (spoje na leták nepatří, ty jsou na webu a v SMS)."""
    pdf.set_draw_color(*BORDER)
    pdf.set_line_width(0.25)
    pdf.set_text_color(*INK)
    pdf.set_font("Sans", "", 12)
    hlavicka = FontFace(family="SansSB", color=INK2, size_pt=9.5, fill_color=(255, 255, 255))
    pdf.set_fill_color(255, 255, 255)
    with pdf.table(col_widths=(128, 54), width=pdf.w - pdf.l_margin - pdf.r_margin, align="LEFT",
                   line_height=5.3, text_align="LEFT", v_align="TOP", borders_layout="HORIZONTAL_LINES",
                   headings_style=hlavicka, markdown=True, padding=(1.6, 2.5, 1.6, 0), cell_fill_mode="NONE") as t:
        t.row(["LÉKAŘ A ADRESA", "TELEFON"])
        for p in lekari:
            radky = [f"**{_md(p['nazev'])}**", _md(p["typ_nazev"].capitalize())]
            if p.get("lekari") and p["lekari"] != p["nazev"]:
                radky.append(_md(_jmena(p["lekari"])))
            if p.get("adresa"):
                radky.append(_md(p["adresa"]))
            tel = "\n".join(f"**{telefon_cz(x)}**" for x in p["telefon"][:2]) or "telefon neuveden"
            t.row(["\n".join(radky), tel])
    pdf.ln(3)


def _vykresli(d: dict, n_nabira: int, n_nejblizsi: int) -> FPDF:
    pdf = _Letak(d["obec"], date.today().strftime("%d. %m. %Y").lstrip("0").replace(". 0", ". "))
    pdf.add_page()
    # hlavička v barvě značky
    pdf.set_fill_color(*PRIMARY)
    pdf.rect(0, 0, pdf.w, 27, style="F")
    pdf.image(str(FONTY.parent / "logo" / "dojedeme-mark-dark.svg"), x=pdf.l_margin - 1, y=6.5, w=12)   # značka D-smyčka
    pdf.set_text_color(*ON_PRIMARY)
    pdf.set_xy(pdf.l_margin + 12.5, 7)
    pdf.set_font("Sans", "B", 19)
    pdf.cell(60, 8, "Dojedeme")
    pdf.set_xy(pdf.l_margin + 12.5, 15.5)
    pdf.set_font("Sans", "", 11)
    pdf.cell(80, 5, "K lékaři a zase domů.")
    pdf.set_xy(pdf.w - pdf.r_margin - 100, 6.5)
    pdf.set_font("Sans", "", 11)
    pdf.cell(100, 5, "Leták pro obec", align="R", new_x="LEFT", new_y="NEXT")
    pdf.set_font("Sans", "B", 18)
    pdf.cell(100, 9, d["obec"], align="R")
    pdf.set_xy(pdf.l_margin, 34)

    pdf.set_text_color(*INK)
    pdf.set_font("Sans", "B", 21)
    pdf.multi_cell(0, 9, "Lékaři, kteří přijímají nové pacienty", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(1)
    pdf.set_font("Sans", "", 12)
    pdf.set_text_color(*INK2)
    odkud = f"ze zastávky {_zastavka(d['zastavka'])}" if d["zastavka"] else f"z obce {d['obec']}"
    pdf.multi_cell(0, 5.8, f"Dostanete se k nim veřejnou dopravou {odkud} do {d['limit_min'] // 60} hodin. "
                           "Před návštěvou zavolejte, jestli pacienty stále přijímají.",
                   new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    if d["nabira"]:
        _tabulka(pdf, d["nabira"][:n_nabira], d["zastavka"])
        zbyva = len(d["nabira"]) - n_nabira
        if zbyva > 0:
            pdf.set_font("SansSB", "", 11)
            pdf.set_text_color(*PRIMARY)
            pdf.multi_cell(0, 5.5, f"Další pracoviště dál od obce ({zbyva}) najdete na dojedeme.cz/pro-obce.",
                           new_x="LMARGIN", new_y="NEXT")
            pdf.ln(2)
    else:
        _box(pdf, PRIMARY_TINT, "V dosahu jsme lékaře, který přijímá, nenašli",
             f"Do {d['limit_min'] // 60} hodin veřejnou dopravou jsme nenašli lékaře, o kterém víme, že přijímá nové pacienty. "
             "Zavolejte lékařům níže nebo své zdravotní pojišťovně.")

    nejblizsi = [q for typ in ("Praktický lékař", "Zubař")
                 for q in [x for x in d["nejblizsi"] if x["typ_nazev"] == typ][:n_nejblizsi]]
    if nejblizsi:
        pdf.set_text_color(*INK)
        pdf.set_font("Sans", "B", 14)
        pdf.multi_cell(0, 6.5, "Nejbližší praktický lékař a zubař", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Sans", "", 11)
        pdf.set_text_color(*INK2)
        pdf.multi_cell(0, 5.2, "Nemusí přijímat nové pacienty, zeptejte se telefonem.", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(1.5)
        _tabulka(pdf, nejblizsi, d["zastavka"])

    for se in d["senior_expres"]:
        tel = f"tel. {telefon_cz(se['telefon'])}" if se.get("telefon") else "objednává se na obecním úřadě"
        text = " ".join(x.strip().rstrip(".") + "." for x in [se.get("podminky"), ("Cena: " + se["cena"]) if se.get("cena") else None,
                                                              ("Jezdí: " + se["provoz"]) if se.get("provoz") else None] if x)
        text = re.sub(r"(\d)\s*-\s*(\d)", r"\1–\2", text)   # 7:00-15:30 → 7:00–15:30
        _box(pdf, SIGNAL_TINT, f"Odvoz pro seniory: {se['nazev']}, {tel}", text or "Podrobnosti vám řeknou na obecním úřadě.")
    _qr(pdf)
    return pdf


def vytvor_pdf(d: dict) -> bytes:
    """Leták na jednu stranu A4: když se všechno nevejde, ubírá nejvzdálenější pracoviště (celý seznam je na webu).
    Nejbližší praktik a zubař (často přímo v obci) zůstávají aspoň po jednom – pro místní jsou nejužitečnější.
    QR kód s textem je v každém pokusu, takže se do jedné strany počítá i on."""
    pokusy = ([(n, 2) for n in range(NA_LETAKU, 6, -1)] + [(n, 1) for n in range(NA_LETAKU, 2, -1)]
              + [(n, 0) for n in range(NA_LETAKU, 2, -1)])
    for n, k in pokusy:
        pdf = _vykresli(d, n, k)
        if pdf.page_no() == 1:
            return bytes(pdf.output())
    return bytes(pdf.output())   # ani nejkratší verze se nevešla – výjimečně 2 strany
