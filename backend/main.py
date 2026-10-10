"""API spojení „Dojedeme“ – veřejná doprava k lékařům a na úřady v Karlovarském kraji.

Spuštění:  .venv\\Scripts\\python.exe -m uvicorn main:app --app-dir backend --port 8000
Dokumentace endpointů: backend/API.md
"""
import asyncio
import contextlib
import functools
import hmac
import io
import json
import math
import os
import re
import time
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qsl

import numpy as np
import pandas as pd
from shapely.geometry import Point, shape
from shapely.strtree import STRtree
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles
from unidecode import unidecode

import letaky
import sms
from routing import GTFS_ZIP as ROUTING_GTFS
from routing import INF, Router, fmt, haversine_m, hm

ROOT = Path(__file__).resolve().parents[1]
CLEAN = ROOT / "data" / "clean"


def nacti_env(cesta: Path) -> None:
    """Jednoduché načtení .env (KEY=hodnota); proměnné prostředí mají přednost."""
    if cesta.exists():
        for radek in cesta.read_text(encoding="utf-8").splitlines():
            k, sep, v = radek.partition("=")
            if sep and not radek.lstrip().startswith("#") and k.strip():
                os.environ.setdefault(k.strip(), v.strip())


nacti_env(ROOT / ".env")
# aktualizované jízdní řády (data/scripts/aktualizuj_jizdni_rady.py, na serveru /var/lib/dojedeme) mají přednost před repem
STAV = Path(os.environ.get("DOJEDEME_STATE") or ROOT / "data" / "cache" / "jizdni_rady")


def gtfs_cesta() -> Path:
    p = STAV / "gtfs_kk.zip"
    return p if p.exists() else ROUTING_GTFS


def gtfs_info() -> dict | None:
    p = STAV / "gtfs_info.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() and (STAV / "gtfs_kk.zip").exists() else None


router = Router(gtfs_cesta())
_gtfs_stav = (gtfs_cesta(), gtfs_cesta().stat().st_mtime)
CILE = pd.read_csv(CLEAN / "cile_kk.csv", dtype={"kod_obce": str, "id": str}).dropna(subset=["lat", "lon"])
SENIOR_TAXI = pd.read_csv(CLEAN / "senior_taxi.csv", dtype=str)
SOUHRN = pd.read_csv(CLEAN / "dostupnost_souhrn_obci.csv", dtype={"kod_obce": str})
DEMO = pd.read_csv(CLEAN / "obce_demografie.csv", dtype={"kod_obce": str})
OBCE = pd.read_csv(CLEAN / "obce.csv", dtype={"kod_obce": str, "ico": str, "psc": str})
HLAVNI = pd.read_csv(CLEAN / "hlavni_zastavky.csv", dtype={"kod_obce": str})
# obec → kód její obce s rozšířenou působností (na úřad se jezdí podle působnosti, ne na nejbližší)
ORP_OBCI = {kod: str(r.kod_orp) for r in pd.read_csv(CLEAN / "orp.csv", dtype=str).itertuples()
            for kod in str(r.kody_obci).split(";") if kod}
_vk = pd.read_csv(CLEAN / "volne_kapacity_2022.csv", dtype=str).dropna(subset=["misto_id", "personal"])
LEKARI_JMENA = {f"{r.misto_id}-{r.kategorie}": r.personal for r in _vk.itertuples()}   # „místo-obor“ → lékaři
STATISTIKY = json.loads((CLEAN / "statistiky.json").read_text(encoding="utf-8"))
LETAKY: dict[str, tuple[dict, bytes | None]] = {}     # kód obce → (data, PDF); maže se při nových jízdních řádech
_zip_uloha: asyncio.Task | None = None                 # příprava ZIPu všech letáků; nová při nových jízdních řádech
VERZE_WEBU = str(int(time.time()))                     # ?v= u /static/ – po nasazení si prohlížeč i Cloudflare vezmou nové CSS/JS
WEB = ROOT / "web"
_obce = json.loads((CLEAN / "obce.geojson").read_text(encoding="utf-8"))["features"]
OBCE_GEOM = [shape(f["geometry"]) for f in _obce]
OBCE_PROPS = [f["properties"] for f in _obce]
OBCE_TREE = STRtree(OBCE_GEOM)
DNY = ["Po", "Ut", "St", "Ct", "Pa", "So", "Ne"]
TYPY = {"praktik": "Praktický lékař", "zubar": "Zubař", "gynekolog": "Gynekolog", "pediatr": "Dětský lékař",
        "ocni": "Oční lékař", "psychiatr": "Psychiatr", "endokrinolog": "Endokrinolog", "rehabilitace": "Rehabilitace",
        "dentalni_hygiena": "Dentální hygiena", "nemocnice": "Nemocnice", "pohotovost": "Pohotovost",
        "zubni_pohotovost": "Zubní pohotovost", "lekarenska_pohotovost": "Lékárenská pohotovost",
        "pohotovost_chirurgie": "Chirurgická pohotovost", "matrika": "Matrika", "obecni_urad": "Obecní úřad",
        "urad_orp": "Úřad ORP"}


class Chyba(Exception):
    pass


# --- pomocné funkce ---------------------------------------------------------------
def param_float(q, name: str, required: bool = True):
    v = q.get(name)
    if v is None:
        if required:
            raise Chyba(f"chybí parametr {name}")
        return None
    try:
        return float(v)
    except ValueError:
        raise Chyba(f"parametr {name} musí být číslo")


def param_datum(q) -> date:
    v = q.get("datum")
    if not v:
        return date.today()
    try:
        return date.fromisoformat(v)
    except ValueError:
        raise Chyba("datum musí být ve tvaru RRRR-MM-DD")


def param_cas(q, default: str | None = None) -> int:
    v = q.get("cas") or default or datetime.now().strftime("%H:%M")
    if not re.fullmatch(r"\d{1,2}:\d{2}", v):
        raise Chyba("cas musí být ve tvaru HH:MM")
    return hm(v)


def obec_bodu(lat: float, lon: float) -> dict | None:
    p = Point(lon, lat)
    for i in OBCE_TREE.query(p):
        if OBCE_GEOM[i].covers(p):
            return OBCE_PROPS[i]
    return None


def senior_taxi_obce(kod_obce: str | None) -> list[dict]:
    if not kod_obce:
        return []
    t = SENIOR_TAXI[SENIOR_TAXI["kod_obce"] == kod_obce]
    h = letaky.txt   # prázdné buňky (např. Bochov nemá telefon) → None, ne NaN
    return [{"obec": h(r["obec"]), "nazev": h(r["nazev_sluzby"]), "telefon": h(r["telefon"]),
             "provozovatel": h(r["provozovatel"]), "podminky": h(r["podminky"]), "cena": h(r["cena"]),
             "provoz": h(r["provoz"]), "zdroj": h(r["zdroj"]), "overeno": h(r["stav_overeni"])} for _, r in t.iterrows()]


def cil_json(r) -> dict:
    out = {"id": r["id"], "typ": r["typ"], "typ_nazev": TYPY.get(r["typ"], r["typ"]), "nazev": r["nazev"],
           "adresa": r["adresa"] if pd.notna(r["adresa"]) else None, "obec": r["obec"] if pd.notna(r["obec"]) else None,
           "kod_obce": r["kod_obce"] if pd.notna(r["kod_obce"]) else None, "lat": r["lat"], "lon": r["lon"],
           "telefon": r["telefon"].split(";") if isinstance(r["telefon"], str) and r["telefon"] else [],
           "web": r["web"] if pd.notna(r["web"]) else None, "hodiny": r["hodiny"] if pd.notna(r["hodiny"]) else None,
           "zdroj": r["zdroj"]}
    if str(r.get("nabira")) == "True":
        out.update({"nabira": True, "nabira_k_datu": r["nabira_k_datu"], "upozorneni": r["nabira_poznamka"]})
    else:
        out["nabira"] = False
    return out


def najdi_cil(cil_id: str):
    c = CILE[CILE["id"] == cil_id]
    if c.empty:
        raise Chyba(f"cíl {cil_id} neexistuje (seznam: /cile)")
    return c.iloc[0]


def bez_diakritiky(s: str) -> str:
    return unidecode(s or "")


# --- endpointy ---------------------------------------------------------------------
async def index(request: Request):
    return JSONResponse({"nazev": "Dojedeme API", "dokumentace": "backend/API.md", "endpointy": [
        "/zdravi", "/cile", "/spojeni", "/spojeni/sms", "/senior-taxi", "/obce/{kod_obce}", "/mapa/h3", "/mapa/obce"]})


async def zdravi(request: Request):
    d = router.den(date.today().strftime("%Y%m%d"))
    info = gtfs_info() or {}
    return JSONResponse({"stav": "ok", "zastavek": len(router.stop_ids), "spoju_dnes": len(d.trip_ids),
                         "cilu": len(CILE), "datum": date.today().isoformat(),
                         "jizdni_rady": {"soubor": gtfs_cesta().name, "aktualizovano": info.get("vytvoreno"),
                                         "plati_do": info.get("plati_do") or manifest_plati_do()}})


def manifest_plati_do() -> str | None:
    return json.loads((CLEAN / "balicek" / "manifest.json").read_text(encoding="utf-8")).get("jizdni_rady_plati_do")


async def hlidej_jizdni_rady(interval: int = 300):
    """Každých 5 min zkontroluje, jestli noční aktualizace nepřinesla nové jízdní řády; když ano, načte je
    na pozadí do nového vyhledávače a teprve hotový ho vymění – API mezitím odpovídá ze starých dat."""
    global router, _gtfs_stav
    while True:
        await asyncio.sleep(interval)
        try:
            p = gtfs_cesta()
            stav = (p, p.stat().st_mtime)
            if stav != _gtfs_stav:
                router = await asyncio.to_thread(Router, p)
                _gtfs_stav = stav
                LETAKY.clear()
                print(f"jízdní řády znovu načteny z {p}", flush=True)
                uloha_zip(znovu=True)
        except Exception as e:  # chybná data nesmí shodit API – zůstanou staré jízdní řády
            print(f"chyba při načítání jízdních řádů: {e}", flush=True)


def uloha_zip(znovu: bool = False) -> asyncio.Task:
    """ZIP všech letáků se tvoří jednou na pozadí (~30 s); stahující jen počká na hotový výsledek."""
    global _zip_uloha
    u = _zip_uloha
    if znovu or u is None or (u.done() and (u.cancelled() or u.exception() is not None)):
        _zip_uloha = asyncio.create_task(asyncio.to_thread(_zip_letaku))
    return _zip_uloha


async def _priprav_zip_po_startu(zpozdeni: int = 20):
    await asyncio.sleep(zpozdeni)   # nejdřív ať se API rozběhne
    try:
        await uloha_zip()
        print("letáky pro všechny obce připravené (ZIP)", flush=True)
    except Exception as e:
        print(f"chyba při přípravě letáků: {e}", flush=True)


@contextlib.asynccontextmanager
async def zivotni_cyklus(app):
    ulohy = [asyncio.create_task(hlidej_jizdni_rady()), asyncio.create_task(_priprav_zip_po_startu()),
             asyncio.create_task(posilej_terminy())]
    yield
    for u in ulohy:
        u.cancel()


async def cile(request: Request):
    """Cíle daného typu seřazené podle dostupnosti veřejnou dopravou z polohy uživatele."""
    q = request.query_params
    typy = [t for t in (q.get("typ") or "").split(",") if t]
    df = CILE[CILE["typ"].isin(typy)] if typy else CILE
    if q.get("nabira") in ("1", "true", "ano"):
        df = df[df["nabira"].astype(str) == "True"]
    if q.get("q"):   # hledání podle jména / adresy / obce bez ohledu na diakritiku („novakova nejdek“)
        hledej = (df["nazev"].fillna("") + " " + df["adresa"].fillna("") + " " + df["obec"].fillna("")).map(
            lambda s: unidecode(s).lower())
        for tok in tokeny(q["q"]):
            hledej = hledej[hledej.str.contains(tok, regex=False)]
        df = df.loc[hledej.index]
    lat, lon = param_float(q, "lat", False), param_float(q, "lon", False)
    limit = int(q.get("limit", 10))
    role = {}
    if q.get("urady") == "moje":   # úřady podle působnosti obce bydliště: obecní úřad a úřad ORP
        o = obec_bodu(lat, lon) if lat is not None and lon is not None else None
        kod = o["kod_obce"] if o else q.get("kod_obce")
        if kod:
            role[f"ou-{kod}"] = "Úřad vaší obce"
            if kod in ORP_OBCI:
                role[f"orp-{ORP_OBCI[kod]}"] = "Úřad obce s rozšířenou působností, pod který vaše obec patří"
        df = CILE[CILE["id"].isin(role)].assign(_poradi=lambda x: x["id"].map(list(role).index))
    if lat is None or lon is None:
        return JSONResponse({"pocet": len(df), "cile": [cil_json(r) for _, r in df.head(limit).iterrows()]})
    od = param_cas(q, "07:00")
    if df.empty:   # filtr nic nenašel (např. dětský lékař, který přijímá) – prázdný seznam, ne chyba
        return JSONResponse({"pocet": 0, "odjezd_od": fmt(od), "cile": []})
    # předvýběr nejbližších 40 vzdušnou čarou (rychlost), pak řazení podle skutečného spojení
    df = df.assign(vzdusne_m=haversine_m(lat, lon, df["lat"].values, df["lon"].values)).nsmallest(40, "vzdusne_m")
    dost = router.dostupnost_cilu((lat, lon), df, param_datum(q), od)
    df = df.join(dost)
    df["cesta_min"] = df["prijezd_min"] - df["odjezd_min"]
    poradi = ["_poradi"] if role else ["prijezd_min", "cesta_min"]   # úřady v pořadí obec → ORP, ostatní podle spojení
    df = df.sort_values(poradi, na_position="last").head(limit)
    out = []
    for _, r in df.iterrows():
        j = cil_json(r)
        j["vzdusne_km"] = round(r["vzdusne_m"] / 1000, 1)
        if role:
            j["role"] = role.get(r["id"])
        if pd.notna(r["prijezd_min"]):
            j.update({"odjezd": fmt(int(r["odjezd_min"])), "prijezd": fmt(int(r["prijezd_min"])),
                      "cesta_min": int(r["cesta_min"]), "prestupy": int(r["prestupy"])})
        else:
            j["dostupne"] = False
        out.append(j)
    return JSONResponse({"pocet": len(out), "odjezd_od": fmt(od), "cile": out})


def _spojeni(q):
    z = (param_float(q, "z_lat"), param_float(q, "z_lon"))
    if q.get("cil_id"):
        cil = cil_json(najdi_cil(q["cil_id"]))
    else:
        cil = {"nazev": q.get("do_nazev", "cíl"), "lat": param_float(q, "do_lat"), "lon": param_float(q, "do_lon")}
    return najdi_spojeni(z, cil, param_datum(q), param_cas(q), min(int(q.get("pocet", 3)), 6),
                         int(q.get("pobyt", 45)), q.get("zpet", "1") not in ("0", "false", "ne"))


def najdi_spojeni(z: tuple[float, float], cil: dict, datum: date, od: int, pocet: int = 3, pobyt: int = 45,
                  se_zpatecnimi: bool = True) -> dict:
    """Spoje tam, zpáteční spoje po `pobyt` minutách a poslední spoj zpět (sdílí /spojeni, /spojeni/sms i SMS služba)."""
    do = (float(cil["lat"]), float(cil["lon"]))
    tam = router.spojeni(z, do, datum, od, pocet)
    zpet, posledni = [], None
    jen_pesky = bool(tam) and len(tam[0]["useky"]) == 1 and tam[0]["useky"][0]["typ"] == "pesky"
    if tam and not jen_pesky and se_zpatecnimi:
        t_zpet = hm(tam[0]["prijezd"]) + pobyt
        # všechny návraty do konce dne (kvůli „poslednímu spoji zpět“, který se nikdy nevynechává)
        vse = router.spojeni(do, z, datum, t_zpet, pocet=40, do_min=23 * 60)
        vse = [s for s in vse if len(s["useky"]) > 1 or s["useky"][0]["typ"] != "pesky"] or vse
        zpet = vse[:pocet]
        posledni = vse[-1] if vse else None
    obec = obec_bodu(*z)
    den = f"{DNY[datum.weekday()]} {datum.day}.{datum.month}."
    return {"datum": datum.isoformat(), "den": den, "z": {"lat": z[0], "lon": z[1], "obec": obec["nazev"] if obec else None},
            "cil": cil, "tam": tam, "zpet_od": fmt(hm(tam[0]["prijezd"]) + pobyt) if tam else None, "zpet": zpet,
            "posledni_zpet": posledni, "zpet_mozne": bool(zpet) or jen_pesky, "jen_pesky": jen_pesky,
            "senior_expres": senior_taxi_obce(obec["kod_obce"] if obec else None)}


async def spojeni(request: Request):
    return JSONResponse(_spojeni(request.query_params))


def sms_text(s: dict, dnes: date | None = None, max_znaku: int = 306) -> str:
    """SMS podle design/BRAND.md (kap. 5): bez diakritiky, max. 2 SMS (306 znaků GSM-7),
    `Cil Mesto: den odj. H:MM Zastavka -> H:MM Cil. Zpet H:MM, H:MM. Senior Expres 736647582`.
    Při zkracování ubírá zpáteční časy, ale poslední spoj zpět nikdy nevynechá."""
    c = s["cil"]
    hlava = f"{c['nazev'][:40]}" + (f" {c['obec']}" if c.get("obec") else "")
    if not s["tam"]:
        tam = f"{s['den']} spoj nenalezen."
    else:
        t = s["tam"][0]
        jizdy = [u for u in t["useky"] if u["typ"] != "pesky"]
        if jizdy:
            j = jizdy[0]
            prestup = f" ({t['prestupy']} prestup)" if t["prestupy"] == 1 else (f" ({t['prestupy']} prestupy)" if t["prestupy"] else "")
            tam = f"{s['den']} odj. {j['odjezd']} {j['z']['nazev']} -> {t['prijezd']}{prestup}."
        else:
            tam = f"{s['den']} pesky {t['minut']} min."
    se = ""
    if s["senior_expres"]:
        se = f" {s['senior_expres'][0]['nazev']} {s['senior_expres'][0]['telefon'].replace('+420', '')}"
    upoz = " Udaj z 2022, overte telefonem." if c.get("upozorneni") else ""
    casy = [z["odjezd"] for z in s["zpet"]]
    posl = s["posledni_zpet"]["odjezd"] if s.get("posledni_zpet") else None
    for n in range(min(3, len(casy)), -1, -1):
        vyber = casy[:n] + ([posl] if posl and posl not in casy[:n] else [])
        if s.get("jen_pesky"):
            zpet = ""
        elif vyber:
            zpet = " Zpet " + ", ".join(vyber) + (" (posledni)" if posl else "") + "."
        else:
            je_dnes = s["datum"] == (dnes or date.today()).isoformat()
            zpet = (" Dnes se uz zpet nedostanete." if je_dnes else " V ten den se zpet nedostanete.") if s["tam"] else ""
        text = bez_diakritiky(f"{hlava}: {tam}{zpet}{se}{upoz}")
        if len(text) <= max_znaku:
            return text
    return text[:max_znaku]


async def spojeni_sms(request: Request):
    s = _spojeni(request.query_params)
    text = sms_text(s)
    return JSONResponse({"text": text, "znaku": len(text), "sms": 1 if len(text) <= 160 else math.ceil(len(text) / 153)})


# --- SMS služba ------------------------------------------------------------------------
ULOZISTE = sms.Uloziste(Path(os.environ.get("DOJEDEME_DB") or ROOT / "data" / "cache" / "dojedeme.db"))
SMS_LIMIT_DEN = int(os.environ.get("SMS_LIMIT_DEN") or 30)


def vytvor_branu():
    e = os.environ.get
    if e("SMS_BRANA") == "gosms" and e("GOSMS_CLIENT_ID") and e("GOSMS_CLIENT_SECRET") and e("GOSMS_CHANNEL_ID"):
        return sms.GoSMS(e("GOSMS_CLIENT_ID"), e("GOSMS_CLIENT_SECRET"), int(e("GOSMS_CHANNEL_ID")), e("GOSMS_TEST") == "1")
    if e("SMS_BRANA") == "twilio" and e("TWILIO_ACCOUNT_SID") and e("TWILIO_AUTH_TOKEN") and e("TWILIO_CISLO"):
        return sms.Twilio(e("TWILIO_ACCOUNT_SID"), e("TWILIO_AUTH_TOKEN"), e("TWILIO_CISLO"))
    if e("SMS_BRANA") == "android" and e("SMSGATE_USER") and e("SMSGATE_PASSWORD"):
        return sms.AndroidSmsGate(e("SMSGATE_USER"), e("SMSGATE_PASSWORD"), e("SMSGATE_URL") or "https://api.sms-gate.app/3rdparty/v1")
    if e("SMS_BRANA") == "iphone":   # odchozí SMS čekají ve frontě, iPhone služby si je vyzvedne
        return sms.IphoneFronta(ULOZISTE)
    return sms.Simulator()


BRANA = vytvor_branu()


def text_seznamu(profil: dict, uvod: str = "Vase cile:") -> str:
    polozky = []
    for z in profil["zkratky"]:
        c = CILE[CILE["id"] == z["cil_id"]]
        nazev = z["popis"] or (c.iloc[0]["nazev"] if not c.empty else z["cil_id"])
        polozky.append(f"{z['kod']} {nazev}")
    text = bez_diakritiky(f"{uvod} " + ", ".join(polozky) + ". Napiste napr. " +
                          "*" + (profil["zkratky"][0]["kod"] if profil["zkratky"] else "11") + " nebo *POMOC.")
    return text[:306]


def bez_pesky(spoje: list[dict]) -> list[dict]:
    """Spoje s jízdou (cesta jen pěšky je v nabídce, když je cíl blízko; do SMS ji nechceme, pokud jede i spoj)."""
    return [s for s in spoje if len(s["useky"]) > 1 or s["useky"][0]["typ"] != "pesky"] or spoje


def odjezd_jizdy(s: dict) -> str:
    """Odjezd prvního autobusu nebo vlaku (stejný čas jako „odj.“ v SMS); u cesty pěšky odchod."""
    jizdy = [u for u in s["useky"] if u["typ"] != "pesky"]
    return jizdy[0]["odjezd"] if jizdy else s["odjezd"]


def zastavka_jizdy(s: dict) -> str | None:
    jizdy = [u for u in s["useky"] if u["typ"] != "pesky"]
    return jizdy[0]["z"]["nazev"] if jizdy else None


def se_text(doma: tuple[float, float]) -> str:
    obec = obec_bodu(*doma)
    sl = senior_taxi_obce(obec["kod_obce"] if obec else None)
    return f" {sl[0]['nazev']} {sl[0]['telefon'].replace('+420', '')}." if sl and sl[0].get("telefon") else ""


def posledni_cil(telefon: str, profil: dict, ted: datetime) -> dict | None:
    """Kam senior naposledy jel: poslední SMS s číslem cíle za posledních 12 hodin."""
    od = (ted - timedelta(hours=12)).isoformat(timespec="seconds")
    for z in ULOZISTE.log(telefon, limit=30):
        if z["smer"] != "in" or z["cas"] < od:
            continue
        p = sms.rozpoznej(z["text"], ted.date())
        if p.typ == "spoj":
            zk = next((x for x in profil["zkratky"] if x["kod"] == p.kod), None)
            if zk:
                return zk
    return None


def text_domu(telefon: str, profil: dict, kod: str | None, ted: datetime) -> str:
    """SMS *0: spoje domů od místa, kam senior naposledy jel (nebo *0 11 = od místa 11)."""
    zk = next((x for x in profil["zkratky"] if x["kod"] == kod), None) if kod else posledni_cil(telefon, profil, ted)
    if not zk and len(profil["zkratky"]) == 1:
        zk = profil["zkratky"][0]
    if not zk:
        kody = ", ".join(f"*0 {z['kod']}" for z in profil["zkratky"][:3])
        return bez_diakritiky(f"Odkud jedete domu? Napiste *0 a cislo mista, napr. {kody or '*0 11'}.")
    c = CILE[CILE["id"] == zk["cil_id"]]
    if c.empty:
        return bez_diakritiky("To misto uz v nasich datech neni. Pozadejte blizkeho o upravu v aplikaci Dojedeme.")
    cil = cil_json(c.iloc[0])
    doma = (profil["bydliste_lat"], profil["bydliste_lon"])
    misto = (float(cil["lat"]), float(cil["lon"]))
    ted_min = ted.hour * 60 + ted.minute
    vse = bez_pesky(router.spojeni(misto, doma, ted.date(), ted_min, pocet=40, do_min=23 * 60))
    nazev = (zk["popis"] or cil["nazev"])[:40]
    if not vse:
        return bez_diakritiky(f"Domu z {nazev}: dnes uz nic nejede.{se_text(doma)}")[:306]
    prvni = vse[0]
    jizdy = [u for u in prvni["useky"] if u["typ"] != "pesky"]
    if not jizdy:
        return bez_diakritiky(f"Domu z {nazev}: pesky asi {prvni['minut']} min.")
    dalsi = [odjezd_jizdy(s) for s in vse[1:3]]
    posl = odjezd_jizdy(vse[-1])
    prestup = f" ({prvni['prestupy']} prestup)" if prvni["prestupy"] == 1 else (
        f" ({prvni['prestupy']} prestupy)" if prvni["prestupy"] else "")
    text = f"Domu z {nazev}: odj. {jizdy[0]['odjezd']} {jizdy[0]['z']['nazev']} -> doma {prvni['prijezd']}{prestup}."
    if dalsi:
        text += " Dalsi " + ", ".join(dalsi) + "."
    if len(vse) > 1 and posl not in dalsi:
        text += f" Posledni dnes {posl}."
    elif len(vse) == 1:
        text += " Je to posledni spoj dnes."
    return bez_diakritiky(text)[:306]


def sms_odpoved(telefon: str, text: str, ted: datetime | None = None) -> str | None:
    """Odpověď na SMS seniora (None = neodpovídat, např. vypnutá služba)."""
    ted = ted or datetime.now()
    dnes, ted_min = ted.date(), ted.hour * 60 + ted.minute
    p = sms.rozpoznej(text, dnes)
    profil = ULOZISTE.profil(telefon)
    if p.typ == "pomoc":
        return sms.TEXT_POMOC
    if profil is None:
        return sms.TEXT_NEZNAME_CISLO
    if p.typ == "zrusit":
        if not profil["overeno"]:            # senior číslo nikdy nepotvrdil → nastavení smažeme úplně
            ULOZISTE.smaz_profil(telefon)
            return sms.TEXT_ZRUSENO_NEOVERENE
        ULOZISTE.odpoj_spravce(telefon)
        return sms.TEXT_ZRUSENO
    if not profil["overeno"]:
        # potvrzení čísla: senior pošle 4místný kód, který blízký vidí v aplikaci (*4821)
        m = re.search(r"(?<!\d)(\d{4})(?!\d)", text)
        if m and ULOZISTE.over_kod(telefon, m[1]):
            return text_seznamu(ULOZISTE.profil(telefon), "Hotovo, Dojedeme je zapnute. Vase cile:")
        return sms.TEXT_CEKA_NA_OVERENI
    if p.typ == "stop":
        ULOZISTE.nastav_aktivni(telefon, False)
        return sms.TEXT_STOP
    if p.typ == "start":
        ULOZISTE.nastav_aktivni(telefon, True)
        return sms.TEXT_START
    if not profil["aktivni"]:
        return None
    if p.typ == "domu":
        return text_domu(telefon, profil, p.kod, ted)
    if p.typ in ("seznam", "nerozumim"):
        return text_seznamu(profil, "Nerozumim zprave. Vase cile:" if p.typ == "nerozumim" else "Vase cile:")
    zk = next((z for z in profil["zkratky"] if z["kod"] == p.kod), None)
    if not zk:
        return text_seznamu(profil, f"Cil {p.kod} nemate nastaveny. Vase cile:")
    c = CILE[CILE["id"] == zk["cil_id"]]
    if c.empty:
        return bez_diakritiky(f"Cil {p.kod} uz v nasich datech neni. Pozadejte blizkeho o upravu v aplikaci Dojedeme.")
    cil = cil_json(c.iloc[0])
    doma = (profil["bydliste_lat"], profil["bydliste_lon"])
    if p.datum:
        od = p.od_min if p.od_min is not None else (max(ted_min, 6 * 60) if p.datum == dnes else 6 * 60)
        return sms_text(najdi_spojeni(doma, cil, p.datum, od), dnes)
    # bez data: nejbližší den (do týdne), kdy se dá dojet tam i zpět – večer a o víkendu tedy třeba až pondělí
    prvni = None
    for i in range(7):
        d = dnes + timedelta(days=i)
        od = (p.od_min if p.od_min is not None else max(ted_min, 6 * 60)) if i == 0 else (p.od_min or 6 * 60)
        s = najdi_spojeni(doma, cil, d, od)
        prvni = prvni or s
        if s["tam"] and s["zpet_mozne"]:
            return sms_text(s, dnes)
    return sms_text(prvni, dnes)


async def zpracuj_prichozi(telefon: str, text: str, brana: str, ext_id: str | None, odeslat: bool = True) -> dict:
    telefon = sms.normalizuj_telefon(telefon)
    if not ULOZISTE.zaloguj("in", telefon, text, brana, ext_id):
        return {"telefon": telefon, "duplicitni": True}
    odpoved = sms_odpoved(telefon, text)
    if odpoved is None:
        return {"telefon": telefon, "odpoved": None}
    if ULOZISTE.odeslano_dnes(telefon) >= SMS_LIMIT_DEN:
        ULOZISTE.zaloguj("out", telefon, odpoved, BRANA.nazev, stav="neodeslano: denni limit")
        return {"telefon": telefon, "odpoved": None, "stav": "denni limit"}
    if not odeslat:   # odpověď odejde v odpovědi webhooku (Twilio TwiML)
        ULOZISTE.zaloguj("out", telefon, odpoved, brana, stav="twiml")
        return {"telefon": telefon, "odpoved": odpoved, "stav": "twiml"}
    try:
        stav = await BRANA.posli(telefon, odpoved)
    except Exception as e:  # chyba brány nesmí shodit webhook (brána by ho opakovala)
        stav = f"chyba: {e}"
    ULOZISTE.zaloguj("out", telefon, odpoved, BRANA.nazev, stav=stav)
    return {"telefon": telefon, "odpoved": odpoved, "stav": stav}


def over_tajemstvi(request: Request):
    tajne = os.environ.get("SMS_WEBHOOK_SECRET")
    if not tajne or not hmac.compare_digest(request.path_params["tajemstvi"], tajne):
        raise Chyba("neplatný webhook")


def over_token(request: Request):
    token = os.environ.get("API_TOKEN")
    if not token or not hmac.compare_digest(request.headers.get("x-api-token", ""), token):
        raise Opravneni()


class Opravneni(Exception):
    pass


async def json_telo(request: Request):
    try:
        return await request.json()
    except Exception:
        raise Chyba("tělo požadavku musí být JSON")


async def sms_gosms(request: Request):
    """Webhook GoSMS „Odpovědi“: POST pole událostí {event: "reply", reply: {recipients: {"+420…": [{id, message}]}}}."""
    over_tajemstvi(request)
    telo = await json_telo(request)
    vysledky = []
    for udalost in telo if isinstance(telo, list) else [telo]:
        if udalost.get("event") != "reply":
            continue
        for telefon, odpovedi in ((udalost.get("reply") or {}).get("recipients") or {}).items():
            for o in odpovedi:
                vysledky.append(await zpracuj_prichozi(telefon, o.get("message", ""), "gosms", str(o.get("id"))))
    return JSONResponse({"zpracovano": len(vysledky)})


async def sms_android(request: Request):
    """Webhook aplikace SMS Gateway for Android: {event: "sms:received", payload: {message, sender, messageId}}."""
    over_tajemstvi(request)
    klic = os.environ.get("SMSGATE_SIGNING_KEY")
    if klic and not sms.over_podpis_android(klic, await request.body(), request.headers.get("x-signature"),
                                            request.headers.get("x-timestamp")):
        raise Chyba("neplatný podpis")
    telo = await json_telo(request)
    if telo.get("event") != "sms:received":
        return JSONResponse({"zpracovano": 0})
    p = telo.get("payload") or {}
    v = await zpracuj_prichozi(p.get("sender") or p.get("phoneNumber") or "", p.get("message", ""), "android",
                               p.get("messageId") or telo.get("id"))
    return JSONResponse({"zpracovano": 1, "odpoved": bool(v.get("odpoved"))})


async def sms_twilio(request: Request):
    """Webhook Twilio „A message comes in“ (form: From, Body, MessageSid) → odpověď jako TwiML."""
    over_tajemstvi(request)
    form = dict(parse_qsl((await request.body()).decode("utf-8"), keep_blank_values=True))
    token, verejna = os.environ.get("TWILIO_AUTH_TOKEN"), os.environ.get("PUBLIC_URL")
    if token and verejna:   # podpis se počítá z veřejné URL, kterou Twilio volá (ne z interní za nginxem)
        url = verejna.rstrip("/") + request.url.path
        if not sms.over_podpis_twilio(token, url, form, request.headers.get("x-twilio-signature")):
            raise Chyba("neplatný podpis Twilio")
    v = await zpracuj_prichozi(form.get("From", ""), form.get("Body", ""), "twilio", form.get("MessageSid"), odeslat=False)
    return Response(sms.twiml(v.get("odpoved")), media_type="text/xml")


async def sms_iphone(request: Request):
    """Brána přes iPhone (aplikace Zkratky): automatizace „Když přijde zpráva obsahující *“ pošle sem
    odesílatele a text (GET parametry, formulář nebo JSON) a odpověď (čistý text) odešle zpět akcí „Odeslat zprávu“."""
    over_tajemstvi(request)
    data = dict(request.query_params)
    if request.method == "POST":
        telo = await request.body()
        ct = request.headers.get("content-type", "")
        if "json" in ct:
            data.update(json.loads(telo or b"{}"))
        elif telo:
            data.update(parse_qsl(telo.decode("utf-8"), keep_blank_values=True))
    telefon = str(data.get("telefon") or data.get("from") or data.get("sender") or "")
    text = str(data.get("text") or data.get("body") or "")
    # diagnostika zkratky: co přišlo jako odesílatel (zkráceně) – číslo, e-mail Apple ID, nebo jméno kontaktu
    druh = "e-mail" if "@" in telefon else ("cislo" if re.search(r"\d{9}", re.sub(r"\D", "", telefon)) else "jmeno/prazdne")
    print(f"iphone: odesilatel={druh} ({len(telefon)} zn., konec {telefon[-3:]!r}) text={text[:8]!r} "
          f"fronta={request.query_params.get('fronta')}", flush=True)
    if not re.search(r"\d{9}", re.sub(r"\D", "", telefon)):
        return Response("", media_type="text/plain")   # odesílatel bez čísla (např. jméno kontaktu) → neodpovídat
    if je_cislo_sluzby(telefon):
        # zkratka posílá místo odesílatele číslo samotného iPhonu (pole telefon vyplněné napevno) → odpověď by šla špatně
        print(f"iphone: zprava s odesilatelem = cislo sluzby, zkontrolujte zkratku (pole telefon = Odesilatel)", flush=True)
        return Response("", media_type="text/plain")
    # iPhone je zároveň osobní telefon: reagujeme jen na zprávy pro Dojedeme (s „*“ nebo příkazem),
    # aby automatizace neodpovídala na běžné SMS od známých
    if "*" not in text and sms.rozpoznej(text, date.today()).typ not in ("pomoc", "seznam", "stop", "start") \
            or (text.strip() == "" or text.strip() == "?"):
        return Response("", media_type="text/plain")
    if request.query_params.get("fronta") == "1" and BRANA.nazev == "iphone":
        # odpověď jde do fronty s číslem odesílatele, pošle ji zkratka „Dojedeme – odeslat frontu“;
        # zkratka pro příchozí pak nemusí umět dát Odesílatele jako příjemce zprávy
        await zpracuj_prichozi(telefon, text, "iphone", None, odeslat=True)
        return Response("", media_type="text/plain")
    v = await zpracuj_prichozi(telefon, text, "iphone", None, odeslat=False)
    return Response(v.get("odpoved") or "", media_type="text/plain; charset=utf-8")


async def sms_iphone_fronta(request: Request):
    """Fronta odchozích SMS pro iPhone služby (zkratka „Dojedeme – odeslat frontu“, backend/deploy/iphone-zkratka.md).
    Vrátí {"zpravy": [{"telefon", "text"}]} a zprávy označí jako převzaté. S ?cekat=N (nejvýš 25 s) počká,
    než něco přibude, takže smyčka ve zkratce pošle SMS skoro hned a server přitom nezatěžuje."""
    over_tajemstvi(request)
    try:
        cekat = max(0, min(int(request.query_params.get("cekat", "0")), 25))
    except ValueError:
        cekat = 0
    konec = time.monotonic() + cekat
    while not ULOZISTE.ceka_ve_fronte() and time.monotonic() < konec:
        await asyncio.sleep(1)
    return JSONResponse({"zpravy": [{"telefon": z["telefon"], "text": z["text"]} for z in ULOZISTE.vyzvedni_frontu()]})


async def sms_iphone_fronta_jedna(request: Request):
    """Jednodušší varianta pro zkratku: jedna zpráva rovnou jako {"telefon": "+420…", "text": "…"}
    (prázdné řetězce, když ve frontě nic není). Ve zkratce pak není potřeba seznam ani smyčka přes položky."""
    over_tajemstvi(request)
    try:
        cekat = max(0, min(int(request.query_params.get("cekat", "0")), 25))
    except ValueError:
        cekat = 0
    konec = time.monotonic() + cekat
    while not ULOZISTE.ceka_ve_fronte() and time.monotonic() < konec:
        await asyncio.sleep(1)
    zpravy = ULOZISTE.vyzvedni_frontu(limit=1)
    z = zpravy[0] if zpravy else {"telefon": "", "text": ""}
    return JSONResponse({"telefon": z["telefon"], "text": z["text"], "dalsi": ULOZISTE.ceka_ve_fronte()})


async def sms_simulator(request: Request):
    """Simulace SMS pro demo a testy: {telefon, text, odeslat}. S odeslat=true (a tokenem) odpověď opravdu odešle."""
    telo = await json_telo(request)
    telefon = sms.normalizuj_telefon(str(telo.get("telefon", "")))
    if not telefon:
        raise Chyba("chybí telefon")
    if telo.get("odeslat"):
        over_token(request)
        return JSONResponse(await zpracuj_prichozi(telefon, str(telo.get("text", "")), "simulator", None))
    odpoved = sms_odpoved(telefon, str(telo.get("text", "")))
    return JSONResponse({"telefon": telefon, "odpoved": odpoved, "znaku": len(odpoved or ""),
                         "sms": 0 if not odpoved else (1 if len(odpoved) <= 160 else math.ceil(len(odpoved) / 153))})


def je_admin(request: Request) -> bool:
    admin = os.environ.get("ADMIN_TOKEN")
    return bool(admin) and hmac.compare_digest(request.headers.get("x-admin-token", ""), admin)


COOKIE_RELACE = "dojedeme_relace"


def prihlaseny(request: Request) -> dict | None:
    """Přihlášený blízký podle cookie relace (web), jinak None."""
    return ULOZISTE.uzivatel_relace(request.cookies.get(COOKIE_RELACE))


def over_spravce(request: Request, telefon: str):
    """Profil smí číst a měnit jen jeho správce: přihlášený vlastník (web), kdo ho založil (X-Profil-Klic, iOS),
    nebo admin (X-Admin-Token)."""
    if je_admin(request):
        return
    u = prihlaseny(request)
    if u and ULOZISTE.vlastnik(telefon) == u["id"]:
        return
    over_token(request)
    if not ULOZISTE.klic_sedi(telefon, request.headers.get("x-profil-klic")):
        raise Opravneni()


# --- účty blízkých (web SMS pro blízké) ------------------------------------------------
NEUSPESNA_PRIHLASENI: dict[str, list[float]] = {}   # e-mail / IP → časy neúspěšných pokusů (ochrana proti hádání hesla)
EMAIL_RE = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


def ip_klienta(request: Request) -> str:
    return (request.headers.get("cf-connecting-ip") or request.headers.get("x-real-ip")
            or (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
            or (request.client.host if request.client else "?"))


def omez_pokusy(*klice: str, limit: int = 10, okno_s: int = 900,
                zprava: str = "Příliš mnoho neúspěšných pokusů. Zkuste to prosím za 15 minut."):
    ted = time.time()
    for k in klice:
        pokusy = [t for t in NEUSPESNA_PRIHLASENI.get(k, []) if ted - t < okno_s]
        NEUSPESNA_PRIHLASENI[k] = pokusy
        if len(pokusy) >= limit:
            raise Chyba(zprava)


def zapis_neuspech(*klice: str):
    for k in klice:
        NEUSPESNA_PRIHLASENI.setdefault(k, []).append(time.time())


def s_relaci(request: Request, telo: dict, uzivatel_id: int) -> JSONResponse:
    odpoved = JSONResponse(telo)
    https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    odpoved.set_cookie(COOKIE_RELACE, ULOZISTE.nova_relace(uzivatel_id), max_age=sms.RELACE_DNI * 86400,
                       httponly=True, secure=https, samesite="lax", path="/")
    return odpoved


def prihlasovaci_udaje(telo: dict) -> tuple[str, str]:
    email = str(telo.get("email") or "").strip().lower()
    heslo = str(telo.get("heslo") or "")
    if not EMAIL_RE.fullmatch(email) or len(email) > 200:
        raise Chyba("Zadejte platný e-mail.")
    if not heslo or len(heslo) > 200:   # ukázkové účty: délku hesla nevynucujeme (rozhodnutí týmu 2026-10-10)
        raise Chyba("Zadejte heslo.")
    return email, heslo


def senior_pro_ucet(p: dict) -> dict:
    """Profil seniora pro přehled v účtu: cíle s názvy a čekající ověřovací kód."""
    zkratky = []
    for z in p["zkratky"]:
        c = CILE[CILE["id"] == z["cil_id"]]
        zkratky.append({**z, "nazev": None if c.empty else c.iloc[0]["nazev"],
                        "obec": None if c.empty or pd.isna(c.iloc[0]["obec"]) else c.iloc[0]["obec"]})
    return {**p, "zkratky": zkratky, "overeni": ULOZISTE.cekajici_overeni(p["telefon"])}


async def ucet_registrace(request: Request):
    """Nový účet blízkého (e-mail + heslo) a rovnou přihlášení."""
    email, heslo = prihlasovaci_udaje(await json_telo(request))
    # jedna síť (např. wifi na akci) smí založit až 100 účtů za hodinu – ochrana proti hromadnému zakládání
    klic = "reg:" + ip_klienta(request)
    omez_pokusy(klic, limit=100, okno_s=3600, zprava="Z této sítě vzniklo za poslední hodinu příliš mnoho účtů. "
                                                       "Zkuste to prosím později.")
    uid = ULOZISTE.registruj(email, heslo)
    if uid is None:
        raise Chyba("Účet s tímto e-mailem už existuje. Přihlaste se.")
    zapis_neuspech(klic)
    return s_relaci(request, {"email": email, "seniori": []}, uid)


async def ucet_prihlaseni(request: Request):
    email, heslo = prihlasovaci_udaje(await json_telo(request))
    klice = ("e:" + email, "ip:" + ip_klienta(request))
    omez_pokusy(klice[0])                 # 10 špatných hesel na jeden e-mail za 15 min
    omez_pokusy(klice[1], limit=40)       # víc z jedné IP (sdílená wifi, např. na akci)
    uid = ULOZISTE.prihlas(email, heslo)
    if uid is None:
        zapis_neuspech(*klice)
        raise Chyba("E-mail nebo heslo nesedí.")
    NEUSPESNA_PRIHLASENI.pop("e:" + email, None)
    return s_relaci(request, {"email": email,
                              "seniori": [senior_pro_ucet(p) for p in ULOZISTE.profily_uzivatele(uid)]}, uid)


async def ucet_odhlaseni(request: Request):
    ULOZISTE.zrus_relaci(request.cookies.get(COOKIE_RELACE))
    odpoved = JSONResponse({"odhlaseno": True})
    odpoved.delete_cookie(COOKIE_RELACE, path="/")
    return odpoved


async def ucet(request: Request):
    """GET: přihlášený blízký a jeho senioři ({prihlasen: false}, když nikdo). DELETE {heslo}: smazat účet i profily."""
    u = prihlaseny(request)
    if request.method == "GET":
        if not u:
            return JSONResponse({"prihlasen": False})
        return JSONResponse({"prihlasen": True, "email": u["email"],
                             "seniori": [senior_pro_ucet(p) for p in ULOZISTE.profily_uzivatele(u["id"])],
                             "cislo_sluzby": os.environ.get("SMS_CISLO_SLUZBY")})   # jen přihlášenému správci
    if not u:
        raise Opravneni()
    telo = await json_telo(request)
    if ULOZISTE.prihlas(u["email"], str(telo.get("heslo") or "")) != u["id"]:
        raise Chyba("Heslo nesedí. Účet jsme nesmazali.")
    smazane = ULOZISTE.smaz_ucet(u["id"])
    odpoved = JSONResponse({"smazano": True, "smazane_profily": len(smazane)})
    odpoved.delete_cookie(COOKIE_RELACE, path="/")
    return odpoved


async def ucet_heslo(request: Request):
    """POST {heslo, nove_heslo}: změna hesla přihlášeného blízkého. Ostatní přihlášení se zruší, toto zůstane."""
    u = prihlaseny(request)
    if not u:
        raise Opravneni()
    telo = await json_telo(request)
    klic = "heslo:" + str(u["id"])
    omez_pokusy(klic, limit=10, okno_s=900, zprava="Příliš mnoho pokusů. Zkuste to prosím za chvíli.")
    if ULOZISTE.prihlas(u["email"], str(telo.get("heslo") or "")) != u["id"]:
        zapis_neuspech(klic)
        raise Chyba("Současné heslo nesedí.")
    nove = str(telo.get("nove_heslo") or "")
    if not nove or len(nove) > 200:
        raise Chyba("Zadejte nové heslo.")
    ULOZISTE.zmen_heslo(u["id"], nove, request.cookies.get(COOKIE_RELACE))
    return JSONResponse({"zmeneno": True})


async def ucet_poslat_spoj(request: Request):
    """Přihlášený blízký pošle nalezený spoj SMS svému seniorovi. Text skládá server ze stejných parametrů jako
    /spojeni (nikdo tak nepošle cizí text) a jen na čísla, která má blízký v účtu a senior je potvrdil."""
    u = prihlaseny(request)
    if not u:
        raise Opravneni()
    telo = await json_telo(request)
    telefon = sms.normalizuj_telefon(str(telo.get("telefon") or ""))
    if not telefon or ULOZISTE.vlastnik(telefon) != u["id"]:
        raise Chyba("Spoj jde poslat jen seniorovi, kterého máte v systému.")
    p = ULOZISTE.profil(telefon)
    if not p or not p["overeno"]:
        raise Chyba("Senior ještě nepotvrdil své číslo. Spoj mu půjde poslat, až pošle SMS s kódem.")
    if not p["aktivni"]:
        raise Chyba("Senior si službu vypnul SMS s textem *STOP.")
    klic = f"spoj:{u['id']}"
    omez_pokusy(klic, limit=40, okno_s=3600, zprava="Za poslední hodinu jste poslali hodně SMS. Zkuste to prosím později.")
    if ULOZISTE.odeslano_dnes(telefon) >= SMS_LIMIT_DEN:
        raise Chyba("Tomuto číslu už dnes odešlo hodně SMS. Zkuste to prosím zítra.")
    parametry = {k: str(v) for k, v in telo.items() if v is not None and k not in ("telefon", "cas_hledani", "odjinud")}
    # spoj pro seniora z jeho bydliště; když blízký hledal odjinud, hledá se od času hledání, ne od jeho spoje.
    # Výjimka: blízký v systému výslovně zvolil jiné místo odjezdu (odjinud: true), pak platí to.
    if not telo.get("odjinud") and p.get("bydliste_lat") is not None and p.get("bydliste_lon") is not None:
        try:
            z_lat, z_lon = float(parametry.get("z_lat", "nan")), float(parametry.get("z_lon", "nan"))
        except ValueError:
            z_lat = z_lon = float("nan")
        if not (abs(z_lat - p["bydliste_lat"]) < 0.004 and abs(z_lon - p["bydliste_lon"]) < 0.006):
            if telo.get("cas_hledani"):
                parametry["cas"] = str(telo["cas_hledani"])
            parametry["z_lat"], parametry["z_lon"] = str(p["bydliste_lat"]), str(p["bydliste_lon"])
    text = sms_text(_spojeni(parametry))
    zapis_neuspech(klic)   # počítadlo odeslaných zpráv (stejný mechanismus jako u pokusů o přihlášení)
    try:
        stav = await BRANA.posli(telefon, text)
    except Exception as e:
        stav = f"chyba: {e}"
    ULOZISTE.zaloguj("out", telefon, text, BRANA.nazev, stav=stav)
    if stav.startswith("chyba"):
        raise Chyba("SMS se teď nepodařilo odeslat. Zkuste to prosím za chvíli.")
    return JSONResponse({"telefon": telefon, "text": text, "stav": stav, "fronta": BRANA.nazev == "iphone"})


def telefon_z_cesty(request: Request) -> str:
    telefon = sms.normalizuj_telefon(request.path_params["telefon"])
    if not re.fullmatch(r"\+\d{11,13}", telefon):
        raise Chyba("telefon musí být ve tvaru +420XXXXXXXXX")
    return telefon


def je_cislo_sluzby(telefon: str) -> bool:
    """Číslo služby (iPhone brány) nesmí být seniorem: zprávy by chodily samy sobě."""
    cislo = os.environ.get("SMS_CISLO_SLUZBY")
    return bool(cislo) and sms.normalizuj_telefon(cislo) == sms.normalizuj_telefon(telefon)


async def sms_profil(request: Request):
    """Profil seniora pro SMS službu (spravuje blízký v aplikaci).
    PUT na nový telefon profil založí a vrátí jednorázově `klic` (aplikace si ho uloží do Klíčenky);
    další GET / PUT / DELETE vyžadují hlavičky X-Api-Token + X-Profil-Klic."""
    telefon = telefon_z_cesty(request)
    existuje = ULOZISTE.profil(telefon) is not None
    u = prihlaseny(request)
    prevzeti = False
    if request.method == "PUT" and not existuje and je_cislo_sluzby(telefon):
        raise Chyba("Tohle je číslo samotné služby Dojedeme. Zadejte číslo mobilu seniora.")
    if request.method == "PUT" and not existuje:
        if not je_admin(request) and not u:
            over_token(request)
    else:
        if not existuje:
            raise Chyba(f"profil {telefon} neexistuje")
        prevzeti = request.method == "PUT" and u is not None and ULOZISTE.vlastnik(telefon) is None \
            and not ULOZISTE.ma_klic(telefon)
        if not prevzeti:
            if u and ULOZISTE.vlastnik(telefon) != u["id"] and not je_admin(request) \
                    and not ULOZISTE.klic_sedi(telefon, request.headers.get("x-profil-klic")):
                raise Chyba("Toto číslo už má službu nastavenou někdo jiný. Upravit ji může jen ten, kdo ji nastavil.")
            over_spravce(request, telefon)
    if request.method == "GET":
        return JSONResponse({**ULOZISTE.profil(telefon), "cislo_sluzby": os.environ.get("SMS_CISLO_SLUZBY")})
    if request.method == "DELETE":
        return JSONResponse({"smazano": ULOZISTE.smaz_profil(telefon)})
    telo = await json_telo(request)
    b = telo.get("bydliste") or {}
    if b.get("lat") is None or b.get("lon") is None:
        raise Chyba("chybí bydliste.lat / bydliste.lon")
    zkratky = telo.get("zkratky") or []
    kody = [str(z.get("kod", "")).lstrip("*") for z in zkratky]
    if any(not re.fullmatch(r"[1-9]\d{0,2}", k) for k in kody) or len(set(kody)) != len(kody):
        raise Chyba("kódy zkratek musí být různá čísla 1–999 (např. 11, 12, 13)")
    nezname = [z.get("cil_id") for z in zkratky if CILE[CILE["id"] == z.get("cil_id")].empty]
    if nezname:
        raise Chyba(f"neznámé cil_id: {', '.join(map(str, nezname))}")
    if not telo.get("souhlas"):
        raise Chyba("chybí souhlas seniora se zpracováním čísla a bydliště (souhlas: true)")
    ULOZISTE.uloz_profil(telefon, float(b["lat"]), float(b["lon"]), b.get("popis"), zkratky)
    if u and (not existuje or ULOZISTE.vlastnik(telefon) is None):
        ULOZISTE.nastav_vlastnika(telefon, u["id"])   # profil patří účtu přihlášeného blízkého
    if existuje and prevzeti:
        # převzetí profilu bez správce: senior musí nového blízkého potvrdit kódem, do té doby služba čeká
        overeni = ULOZISTE.zahaj_overeni(telefon)
        out = {**ULOZISTE.profil(telefon), "overeni": overeni, "cislo_sluzby": os.environ.get("SMS_CISLO_SLUZBY")}
        return JSONResponse(out, status_code=201)
    if not existuje:
        klic = ULOZISTE.novy_klic(telefon)
        # admin (testy, demo) zakládá rovnou ověřené profily; z aplikace musí senior potvrdit číslo kódem
        overeni = None if je_admin(request) else ULOZISTE.zahaj_overeni(telefon)
        out = {**ULOZISTE.profil(telefon), "klic": klic, "overeni": overeni,
               "cislo_sluzby": os.environ.get("SMS_CISLO_SLUZBY")}
        return JSONResponse(out, status_code=201)
    return JSONResponse(ULOZISTE.profil(telefon))


async def sms_overeni(request: Request):
    """Nový ověřovací kód pro seniora (platí 48 h), např. když starý vypršel."""
    telefon = telefon_z_cesty(request)
    p = ULOZISTE.profil(telefon)
    if not p:
        raise Chyba(f"profil {telefon} neexistuje")
    over_spravce(request, telefon)
    if p["overeno"]:   # číslo se ověřuje jen jednou; nový kód by ověření zbytečně zrušil
        raise Chyba("Číslo už je ověřené, nový kód není potřeba.")
    return JSONResponse({"telefon": telefon, "overeni": ULOZISTE.zahaj_overeni(telefon),
                         "cislo_sluzby": os.environ.get("SMS_CISLO_SLUZBY")})


# --- termíny u lékaře: večer předem SMS se spojem, který dorazí včas ---------------------
HODINA_PRIPOMINKY = 18      # SMS k termínu chodí den předem od 18:00


def spoj_na_termin(doma: tuple[float, float], cil: dict, datum: date, cas_min: int, pobyt: int = 60) -> dict:
    """Nejpozdější spoj, který dorazí aspoň 10 minut před termínem (kdo dorazí moc brzo, zbytečně čeká),
    a spoje zpět po termínu (+ `pobyt` minut u lékaře)."""
    do = (float(cil["lat"]), float(cil["lon"]))
    kandidati = bez_pesky(router.spojeni(doma, do, datum, max(cas_min - 300, 4 * 60), pocet=25, do_min=cas_min))
    vcas = [s for s in kandidati if hm(s["prijezd"]) <= cas_min - 10]
    tam = vcas[-1] if vcas else (kandidati[0] if kandidati else None)
    if not tam:   # před termínem nic nejede – první spoj po něm (dorazí pozdě, ale aspoň víme kdy)
        kandidati = bez_pesky(router.spojeni(doma, do, datum, cas_min, pocet=1))
        tam = kandidati[0] if kandidati else None
    zpet, posledni = [], None
    if tam:
        od = max(hm(tam["prijezd"]), cas_min) + pobyt
        vse = bez_pesky(router.spojeni(do, doma, datum, od, pocet=40, do_min=23 * 60))
        zpet, posledni = vse[:2], (vse[-1] if vse else None)
    return {"tam": tam, "zpet": zpet, "posledni": posledni, "vcas": bool(vcas)}


def text_terminu(t: dict, profil: dict) -> str:
    """SMS den před termínem, bez diakritiky, nejvýš 306 znaků."""
    datum = date.fromisoformat(t["datum"])
    c = CILE[CILE["id"] == t["cil_id"]]
    if c.empty:
        return bez_diakritiky("Dojedeme: misto vaseho terminu uz v nasich datech neni. Zavolejte blizkemu.")
    cil = cil_json(c.iloc[0])
    doma = (profil["bydliste_lat"], profil["bydliste_lon"])
    kam = (t.get("popis") or cil["nazev"])[:40]
    den = f"{DNY[datum.weekday()]} {datum.day}.{datum.month}."
    s = spoj_na_termin(doma, cil, datum, hm(t["cas"]))
    uvod = f"Dojedeme: {den} v {t['cas']} {kam}."
    if not s["tam"]:
        return bez_diakritiky(f"{uvod} Verejnou dopravou se tam ten den nedostanete.{se_text(doma)}")[:306]
    tam = s["tam"]
    odkud = zastavka_jizdy(tam)
    if s["vcas"]:
        text = f"{uvod} Jedte v {odjezd_jizdy(tam)}" + (f" z {odkud}" if odkud else "") + f", na miste {tam['prijezd']}."
    else:
        text = (f"{uvod} Vcas se tam verejnou dopravou nedostanete. Prvni spoj jede v {odjezd_jizdy(tam)}, "
                f"na miste {tam['prijezd']}.{se_text(doma)}")
    casy = [odjezd_jizdy(x) for x in s["zpet"]]
    posl = odjezd_jizdy(s["posledni"]) if s["posledni"] else None
    if casy:
        text += " Zpet " + ", ".join(casy) + (f", posledni {posl}" if posl and posl not in casy else "") + "."
    else:
        text += f" Zpet uz ten den nic nejede.{se_text(doma)}"
    return bez_diakritiky(text)[:306]


def termin_json(t: dict, profil: dict, s_nahledem: bool = True) -> dict:
    c = CILE[CILE["id"] == t["cil_id"]]
    datum = date.fromisoformat(t["datum"])
    pripominka = datetime.combine(datum - timedelta(days=1), datetime.min.time()).replace(hour=HODINA_PRIPOMINKY)
    return {"id": t["id"], "cil_id": t["cil_id"], "popis": t.get("popis"),
            "nazev": None if c.empty else c.iloc[0]["nazev"], "datum": t["datum"], "cas": t["cas"],
            "pripominka": pripominka.isoformat(timespec="minutes"), "odeslano": t.get("odeslano"),
            "stav": t.get("stav"), "text": text_terminu(t, profil) if s_nahledem else None}


async def odesli_termin(t: dict) -> str:
    """Pošle SMS k termínu přes nastavenou bránu (iPhone: do fronty) a termín označí."""
    profil = ULOZISTE.profil(t["telefon"])
    if not profil or not profil["overeno"] or not profil["aktivni"]:
        ULOZISTE.oznac_termin(t["id"], "neodeslano: senior nema zapnutou sluzbu")
        return "senior nemá zapnutou službu"
    if ULOZISTE.odeslano_dnes(t["telefon"]) >= SMS_LIMIT_DEN:
        return "denní limit"      # zkusí se znovu při dalším průchodu
    text = text_terminu(t, profil)
    try:
        stav = await BRANA.posli(t["telefon"], text)
    except Exception as e:
        stav = f"chyba: {e}"
    ULOZISTE.zaloguj("out", t["telefon"], text, BRANA.nazev, stav=stav)
    if not stav.startswith("chyba"):
        ULOZISTE.oznac_termin(t["id"], stav)
    return stav


async def posilej_terminy(interval: int = 300):
    """Každých 5 minut: od 18:00 pošle SMS ke všem zítřejším termínům, které ještě neodešly."""
    await asyncio.sleep(30)
    while True:
        try:
            ted = datetime.now()
            if ted.hour >= HODINA_PRIPOMINKY:
                for t in ULOZISTE.terminy_k_odeslani((ted.date() + timedelta(days=1)).isoformat()):
                    await odesli_termin(t)
        except Exception as e:   # plánovač nesmí spadnout
            print(f"terminy: {e}", flush=True)
        await asyncio.sleep(interval)


async def sms_terminy(request: Request):
    """GET: termíny seniora u lékaře (s náhledem SMS). POST {cil_id, datum, cas, popis?}: nový termín."""
    telefon = telefon_z_cesty(request)
    p = ULOZISTE.profil(telefon)
    if not p:
        raise Chyba(f"profil {telefon} neexistuje")
    over_spravce(request, telefon)
    if request.method == "GET":
        return JSONResponse({"terminy": [termin_json(t, p) for t in ULOZISTE.terminy(telefon, date.today().isoformat())],
                             "hodina_pripominky": HODINA_PRIPOMINKY})
    telo = await json_telo(request)
    cil_id = str(telo.get("cil_id") or "")
    if CILE[CILE["id"] == cil_id].empty:
        raise Chyba("Vyberte místo z předvoleb seniora nebo ze seznamu.")
    try:
        datum = date.fromisoformat(str(telo.get("datum") or ""))
    except ValueError:
        raise Chyba("Zadejte den termínu.")
    if datum < date.today() or datum > date.today() + timedelta(days=120):
        raise Chyba("Termín musí být dnes nebo v příštích čtyřech měsících.")
    cas = str(telo.get("cas") or "")
    if not re.fullmatch(r"\d{1,2}:\d{2}", cas) or not (5 * 60 <= hm(cas) <= 21 * 60):
        raise Chyba("Zadejte čas termínu mezi 5:00 a 21:00, například 9:30.")
    if len(ULOZISTE.terminy(telefon, date.today().isoformat())) >= 20:
        raise Chyba("Senior má naplánovaných už 20 termínů. Nejdřív nějaký smažte.")
    popis = (str(telo.get("popis") or "").strip() or None)
    id_ = ULOZISTE.pridej_termin(telefon, cil_id, popis[:60] if popis else None, datum.isoformat(), fmt(hm(cas)))
    return JSONResponse(termin_json(ULOZISTE.termin(telefon, id_), p), status_code=201)


async def sms_termin(request: Request):
    """DELETE: smazat termín. POST …/poslat: poslat SMS k termínu hned (ukázka, nebo když je termín zítra)."""
    telefon = telefon_z_cesty(request)
    over_spravce(request, telefon)
    try:
        id_ = int(request.path_params["id"])
    except ValueError:
        raise Chyba("neplatný termín")
    t = ULOZISTE.termin(telefon, id_)
    if not t:
        raise Chyba("Takový termín neexistuje.")
    if request.method == "DELETE":
        ULOZISTE.smaz_termin(telefon, id_)
        return JSONResponse({"smazano": True})
    stav = await odesli_termin(t)
    if stav.startswith("chyba") or stav in ("senior nemá zapnutou službu", "denní limit"):
        raise Chyba(f"SMS se nepodařilo poslat: {stav}.")
    return JSONResponse({"odeslano": True, "stav": stav, "fronta": BRANA.nazev == "iphone",
                         "text": ULOZISTE.log(telefon, limit=1)[0]["text"]})


def text_karticky(p: dict) -> str:
    """Návod pro seniora na kartičku k telefonu (s diakritikou – je pro tisk, ne do SMS)."""
    cislo = os.environ.get("SMS_CISLO_SLUZBY") or ""
    cislice = re.sub(r"\D", "", cislo).removeprefix("420")
    cislo = f"{cislice[0:3]} {cislice[3:6]} {cislice[6:9]}" if len(cislice) == 9 else (cislo or "(číslo služby Dojedeme)")
    # jednoduše a jen to nejnutnější: kam psát, co napsat, co přijde zpátky, jeden příklad na jiný den
    radky = ["Spoje k lékaři přes SMS", f"Pošlete SMS na číslo {cislo}", "Do zprávy napište hvězdičku a číslo místa:"]
    for z in p["zkratky"]:
        c = CILE[CILE["id"] == z["cil_id"]]
        radky.append(f"*{z['kod']}  {z['popis'] or (c.iloc[0]['nazev'] if not c.empty else '')}")
    prvni = f"*{p['zkratky'][0]['kod']}" if p["zkratky"] else "*11"
    radky += ["", "Za chvíli vám přijde SMS, kdy jede autobus tam a kdy zpátky.",
              f"Chcete jet zítra? Napište {prvni} zitra", "Jste u lékaře a chcete domů? Napište *0",
              "Na číslo nevolejte, pište jen SMS."]
    return "\n".join(radky)


async def sms_karticka(request: Request):
    """Kartička s návodem pro seniora (text k vytištění nebo sdílení)."""
    telefon = telefon_z_cesty(request)
    p = ULOZISTE.profil(telefon)
    if not p:
        raise Chyba(f"profil {telefon} neexistuje")
    over_spravce(request, telefon)
    return JSONResponse({"telefon": telefon, "cislo_sluzby": os.environ.get("SMS_CISLO_SLUZBY"), "text": text_karticky(p)})


async def sms_uvod(request: Request):
    """Pošle seniorovi uvítací SMS se seznamem jeho cílů (jen brány, které umí posílat samy – ne iPhone)."""
    telefon = telefon_z_cesty(request)
    p = ULOZISTE.profil(telefon)
    if not p:
        raise Chyba(f"profil {telefon} neexistuje")
    over_spravce(request, telefon)
    text = text_seznamu(p, "Dobry den, tady Dojedeme - k lekari a zase domu. Poslete SMS s cislem cile:")
    stav = await BRANA.posli(telefon, text)
    ULOZISTE.zaloguj("out", telefon, text, BRANA.nazev, stav=stav)
    return JSONResponse({"telefon": telefon, "text": text, "stav": stav})


async def sms_log(request: Request):
    """Log SMS: admin vidí vše, správce profilu jen SMS svého seniora (parametr telefon)."""
    t = request.query_params.get("telefon")
    telefon = sms.normalizuj_telefon(t) if t else None
    if not je_admin(request):
        if not telefon:
            raise Opravneni()
        over_spravce(request, telefon)
    return JSONResponse({"brana": BRANA.nazev, "zpravy": ULOZISTE.log(telefon)})


async def sms_info(request: Request):
    """Veřejné informace o SMS službě pro aplikaci (číslo služby, příkazy)."""
    return JSONResponse({
        # číslo služby je soukromé – dostane ho jen správce profilu (PUT/GET profilu, ověření, kartička)
        "cislo_sluzby": None, "cislo_po_nastaveni": True, "brana": BRANA.nazev, "limit_sms_den": SMS_LIMIT_DEN,
        "prikazy": [{"sms": "*11", "vyznam": "spoje k cíli 11 (nejbližší den, kdy se dá dojet tam i zpět)"},
                    {"sms": "*11 zitra", "vyznam": "zítra (také pozitri, patek, v pondeli…)"},
                    {"sms": "*11 15.10.", "vyznam": "konkrétní datum"},
                    {"sms": "*11 zitra 9:00", "vyznam": "odjezd od 9:00"},
                    {"sms": "*SEZNAM", "vyznam": "seznam cílů"}, {"sms": "*POMOC", "vyznam": "nápověda"},
                    {"sms": "*0", "vyznam": "jedu domů"}, {"sms": "*ZRUSIT", "vyznam": "blízký už nemůže měnit nastavení"},
                    {"sms": "*STOP / *START", "vyznam": "vypnout / zapnout službu"}],
        "napoveda_sms": sms.TEXT_POMOC})


# --- hledání adres (bydliště) – RÚIAN adresy kraje z datového balíčku ---------------------
_adr = pd.DataFrame(json.loads((CLEAN / "balicek" / "adresy.json").read_text(encoding="utf-8")))
_nazvy_obci = dict(zip(pd.read_csv(CLEAN / "obce.csv", dtype=str)["kod_obce"], pd.read_csv(CLEAN / "obce.csv", dtype=str)["nazev"]))
_adr["obec"] = _adr["o"].map(_nazvy_obci)
_adr["text"] = [f"{o} {('č. ev. ' if cp == 'ev.' else '')}{c}" if (u or "") in ("", o) else f"{u} {c}, {o}"
                for u, c, o, cp in zip(_adr["u"].fillna(""), _adr["c"], _adr["obec"].fillna(""), _adr["cp"])]
_adr["hledej"] = (_adr["text"] + " " + _adr["obec"].fillna("")).map(lambda s: unidecode(s).lower())


def tokeny(q: str) -> list[str]:
    return [t for t in re.split(r"[\s,]+", unidecode(q or "").lower()) if t]


async def adresy(request: Request):
    """Našeptávač adresy bydliště: ?q=Abertamy 115 → [{adresa, lat, lon, kod_obce}]."""
    t = tokeny(request.query_params.get("q", ""))
    if not t or len("".join(t)) < 3:
        raise Chyba("parametr q musí mít aspoň 3 znaky")
    m = pd.Series(True, index=_adr.index)
    for tok in t:
        if tok.isdigit():   # číslo domu musí sedět přesně (ne „11“ v „115“)
            m &= _adr["c"].str.split("/").str[0].eq(tok) | _adr["c"].eq(tok)
        else:
            m &= _adr["hledej"].str.contains(tok, regex=False)
    kand = _adr[m]
    # pořadí: nejdřív adresy v obci, která se jmenuje jako hledané slovo („sokolov“ → Sokolov, ne Sokolovská jinde),
    # pak obce, které tím slovem začínají, nakonec ostatní shody (ulice, části obcí); uvnitř skupiny pořadí z dat
    slova = [tok for tok in t if not tok.isdigit()]
    if slova and len(kand) > 1:
        obce_n = kand["obec"].fillna("").map(lambda s: unidecode(s).lower())
        presna = obce_n.map(lambda o: any(o == s or o.split(" ")[0] == s for s in slova))
        zacina = obce_n.map(lambda o: any(o.startswith(s) for s in slova))
        kand = kand.assign(_p=(~presna).astype(int) * 2 + (~zacina).astype(int)).sort_values("_p", kind="stable")
    vys = kand.head(int(request.query_params.get("limit", 10)))
    return JSONResponse({"pocet": int(m.sum()), "adresy": [
        {"adresa": r["text"], "lat": r["la"], "lon": r["lo"], "kod_obce": r["o"]} for _, r in vys.iterrows()]})


async def senior_taxi(request: Request):
    q = request.query_params
    kod = q.get("kod_obce")
    if not kod:
        o = obec_bodu(param_float(q, "lat"), param_float(q, "lon"))
        kod = o["kod_obce"] if o else None
    return JSONResponse({"kod_obce": kod, "sluzby": senior_taxi_obce(kod)})


def _data_letaku(kod: str) -> dict:
    if kod not in LETAKY:
        try:
            d = letaky.data_letaku(kod, router, CILE, OBCE, HLAVNI, senior_taxi_obce(kod), TYPY, LEKARI_JMENA,
                                   None)   # leták je veřejný – soukromé číslo služby na něj nepatří
        except KeyError:
            raise Chyba(f"obec {kod} není v Karlovarském kraji")
        LETAKY[kod] = (d, None)
    return LETAKY[kod][0]


async def obce_seznam(request: Request):
    """Všechny obce kraje: dostupnost, senioři, Senior Expres (pro web Pro obce a administraci)."""
    se = set(SENIOR_TAXI["kod_obce"].dropna())
    df = SOUHRN.merge(OBCE[["kod_obce", "orp", "stred_lat", "stred_lon"]], on="kod_obce", how="left")
    out = df.replace({np.nan: None}).to_dict(orient="records")
    for r in out:
        r["senior_expres"] = r["kod_obce"] in se
        r["letak"] = f"/letaky/{r['kod_obce']}.pdf?v={VERZE_WEBU}"   # Cloudflare drží PDF v cache → po nasazení nová adresa
    return JSONResponse({"pocet": len(out), "obce": sorted(out, key=lambda r: unidecode(r["obec"]))})


async def obec_lekari(request: Request):
    """Lékaři v dosahu veřejné dopravy z obce, kteří přijímají nové pacienty (obsah letáku jako JSON)."""
    d = await asyncio.to_thread(_data_letaku, request.path_params["kod_obce"])
    return JSONResponse(d)


def _jmeno_souboru(obec: str) -> str:
    return "dojedeme-lekari-" + re.sub(r"[^a-z0-9]+", "-", unidecode(obec).lower()).strip("-") + ".pdf"


def _pdf_letaku(kod: str) -> tuple[dict, bytes]:
    d = _data_letaku(kod)
    pdf = LETAKY[kod][1]
    if pdf is None:
        pdf = letaky.vytvor_pdf(d)
        LETAKY[kod] = (d, pdf)
    return d, pdf


async def letak_pdf(request: Request):
    """Leták pro obec na nástěnku (A4, PDF) – bez přihlášení."""
    d, pdf = await asyncio.to_thread(_pdf_letaku, request.path_params["kod_obce"])
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{_jmeno_souboru(d["obec"])}"',
                             "Cache-Control": "public, max-age=3600"})


def _zip_letaku() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for kod in SOUHRN["kod_obce"]:
            d, pdf = _pdf_letaku(kod)
            z.writestr(_jmeno_souboru(d["obec"]), pdf)
    return buf.getvalue()


async def letaky_zip(request: Request):
    """Všechny letáky kraje v jednom ZIPu (pro kraj a ORP). Poprvé se tvoří asi minutu, pak je v paměti."""
    obsah = await asyncio.shield(uloha_zip())   # odpojený prohlížeč nezruší rozpracovanou přípravu
    return Response(obsah, media_type="application/zip",
                    headers={"Content-Disposition": 'attachment; filename="dojedeme-letaky-obci.zip"',
                             "Cache-Control": "public, max-age=3600"})


async def statistiky(request: Request):
    """Klíčová čísla analýzy (data/clean/statistiky.json) pro úvodní stránku a prezentaci."""
    return JSONResponse(STATISTIKY)


def stranka(soubor: str):
    """HTML stránka z web/. Zástupný text {{API_TOKEN}} se doplní z .env (není natvrdo v repu)."""
    async def handler(request: Request):
        cesta = WEB / soubor
        if not cesta.exists():
            raise Chyba("stránka se připravuje")
        html = cesta.read_text(encoding="utf-8")
        # číslo služby je soukromé – na veřejné stránky nepatří (dostane ho jen správce profilu z API)
        html = html.replace("{{API_TOKEN}}", os.environ.get("API_TOKEN", "")).replace("{{CISLO_SLUZBY}}", "")
        html = re.sub(r"""(/(?:static|letaky)/[^"'?\s]+\.(?:css|js|pdf|zip))(?=["'])""", rf"\1?v={VERZE_WEBU}", html)
        return Response(html, media_type="text/html; charset=utf-8", headers={"Cache-Control": "no-cache"})
    return handler


async def obec(request: Request):
    kod = request.path_params["kod_obce"]
    s = SOUHRN[SOUHRN["kod_obce"] == kod]
    if s.empty:
        raise Chyba(f"obec {kod} není v Karlovarském kraji")
    r = s.iloc[0].replace({np.nan: None}).to_dict()
    return JSONResponse({**r, "senior_expres": senior_taxi_obce(kod)})


MAPA_CACHE = {"Cache-Control": "public, max-age=3600"}


async def mapa_h3(request: Request):
    """Hexagony pro pracovní den, nebo ?den=so / ?den=ne (víkend, odjezd z domova 6–12 h)."""
    p = CLEAN / f"h3_dostupnost{DNY_MAPY.get(request.query_params.get('den', 'pd'), '')}.geojson"
    if not p.exists():
        raise Chyba("pro tento den mapa ještě není spočítaná")
    return FileResponse(p, media_type="application/geo+json", headers=MAPA_CACHE)


@functools.cache
def _h3_csv() -> bytes:
    """CSV pro český Excel: středník, desetinná čárka, UTF-8 s BOM (otevře se dvojklikem)."""
    h = pd.read_csv(CLEAN / "h3_dostupnost.csv", dtype={"kod_obce": str, "h3": str})
    return h.to_csv(sep=";", decimal=",", index=False).encode("utf-8-sig")


async def mapa_h3_csv(request: Request):
    """Hexagony jako tabulka (CSV) pro Excel a GIS."""
    return Response(_h3_csv(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="dojedeme-hexagony.csv"', **MAPA_CACHE})


async def mapa_spady(request: Request):
    """Spádové oblasti nemocnic podle vzdálenosti a podle spojů (data/scripts/spadove_oblasti.py)."""
    p = CLEAN / "spadove_oblasti.geojson"
    if not p.exists():
        raise Chyba("spádové oblasti se teprve počítají")
    return FileResponse(p, media_type="application/geo+json", headers=MAPA_CACHE)


async def mapa_spady_souhrn(request: Request):
    p = CLEAN / "spadove_oblasti.json"
    if not p.exists():
        raise Chyba("spádové oblasti se teprve počítají")
    return FileResponse(p, media_type="application/json", headers=MAPA_CACHE)


@functools.cache
def _blizko_daleko() -> dict:
    """Obce podle kategorie: vzdušná vzdálenost k nejbližšímu místu × doba mimo domov k nejdostupnějšímu (P-06)."""
    d = pd.read_csv(CLEAN / "dostupnost_obci.csv", dtype={"kod_obce": str})
    out = {}
    for k in ("praktik", "zubar", "nemocnice"):
        x = d[d["kategorie"] == k]
        out[k] = [{"kod_obce": r.kod_obce, "obec": r.obec, "km": round(float(r.nejblizsi_vzdusne_km), 1),
                   "nejblizsi": letaky.txt(r.nejblizsi_vzdusne), "cil": letaky.txt(r.cil_vhd), "cil_obec": letaky.txt(r.cil_vhd_obec),
                   "mimo_min": None if pd.isna(r.doba_mimo_domov_min) else int(r.doba_mimo_domov_min),
                   "odjezd": letaky.txt(r.odjezd), "navrat": letaky.txt(r.zpet_prijezd),
                   "seniori": None if pd.isna(r.obyvatel_65plus) else int(r.obyvatel_65plus)} for r in x.itertuples()]
    return out


@functools.cache
def _se_mezery() -> dict:
    """Kde chybí Senior Expres (P-11): souhrn a obce s nejhorší dostupností bez služby."""
    j = json.loads((CLEAN / "senior_expres_mezery.json").read_text(encoding="utf-8"))
    d = pd.read_csv(CLEAN / "senior_expres_mezery.csv", dtype={"kod_obce": str})
    obce = []
    for r in d[d["priorita"] == 1].itertuples():
        obce.append({"obec": r.obec, "kod_obce": r.kod_obce, "orp": letaky.txt(r.orp),
                     "seniori": None if pd.isna(r.obyvatel_65plus) else int(r.obyvatel_65plus),
                     "hodnoceni": letaky.txt(r.hodnoceni),
                     "praktik_min": None if pd.isna(r.mimo_domov_praktik_min) else int(r.mimo_domov_praktik_min),
                     "nemocnice_min": None if pd.isna(r.mimo_domov_nemocnice_min) else int(r.mimo_domov_nemocnice_min),
                     "prumer_min": None if pd.isna(r.prumer_mimo_domov_h) else round(float(r.prumer_mimo_domov_h) * 60),
                     "poznamka": re.sub(r"\s*Ověřit[^.]*\.", "", (letaky.txt(r.poznamka) or "").replace("", "")).strip() or None})
    p = j["problemove_obce"]
    return {"problemove_obci": p["obci"], "bez_se_obci": p["bez_senior_expresu"]["obci"],
            "bez_se_seniori": p["bez_senior_expresu"]["obyvatel_65plus"],
            "stredni_bez_se_obci": j["stredni_bez_senior_expresu"]["obci"],
            "stredni_bez_se_seniori": j["stredni_bez_senior_expresu"]["obyvatel_65plus"],
            "obci_se_senior_expresem": j["obci_se_senior_expresem"],
            "vuz_bez_provozu": j.get("vuz_z_dotace_bez_zverejneneho_provozu", []), "obce": obce}


@functools.cache
def _pohotovost() -> dict:
    """Pohotovost v sobotu (P-12, víkendová varianta): souhrn a obce, odkud se v sobotu dopoledne
    nedá veřejnou dopravou dojet na pohotovost a zpět. Večerní varianta zůstává jen v datech (pohotovost_vecer.*)."""
    j = json.loads((CLEAN / "pohotovost_vikend.json").read_text(encoding="utf-8"))
    d = pd.read_csv(CLEAN / "pohotovost_vikend.csv", dtype={"kod_obce": str})
    bez = d[d["lze_zpet"].astype(str).str.lower() != "true"].sort_values("seniori_65plus", ascending=False)
    def po_prijezdu(prijezd, posledni):   # spoj zpět, který odjíždí dřív, než člověk dorazí, nemá smysl ukazovat
        p, z = letaky.txt(prijezd), letaky.txt(posledni)
        return z if p and z and hm(z) > hm(p) else None
    obce = [{"obec": r.obec, "orp": letaky.txt(r.orp),
             "seniori": None if pd.isna(r.seniori_65plus) else int(r.seniori_65plus),
             "stav": letaky.txt(r.stav), "pohotovost": letaky.txt(r.pohotovost_obec),
             "prijezd": letaky.txt(r.prijezd), "posledni_zpet": po_prijezdu(r.prijezd, r.posledni_spoj_zpet),
             "nejpozdeji": letaky.txt(r.nejpozdeji_na_pohotovosti)} for r in bez.itertuples()]
    a, o = j["adresy"], j["obce"]
    priklad = next((x for x in j["top10_bez_navratu"] if x.get("prijezd") and x.get("posledni_spoj_zpet")), None)
    return {"scenar": j["scenar"], "seniori_bez_navratu": a["seniori_bez_navratu"],
            "podil_bez_navratu_pct": a["podil_senioru_bez_navratu_pct"], "jeden_z_kolika": a["jeden_z_kolika_senioru"],
            "seniori_nedojedou_tam": a["seniori_nedojedou_tam"],
            "obci_bez_navratu": o["bez_navratu_tyz_vecer"]["obci"], "seniori_obci_bez_navratu": o["bez_navratu_tyz_vecer"]["seniori"],
            "obci_dobre_pres_den": o["bez_navratu_tyz_vecer"].get("z_toho_obci_s_dobrou_nebo_stredni_dostupnosti_pres_den"),
            "priklad": priklad, "obce": obce}


async def mapa_pohotovost(request: Request):
    return JSONResponse(_pohotovost(), headers=MAPA_CACHE)


async def mapa_pohotovost_csv(request: Request):
    return FileResponse(CLEAN / "pohotovost_vikend.csv", media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": 'attachment; filename="dojedeme-pohotovost-sobota.csv"', **MAPA_CACHE})


async def mapa_se_mezery(request: Request):
    return JSONResponse(_se_mezery(), headers=MAPA_CACHE)


async def mapa_se_mezery_csv(request: Request):
    return FileResponse(CLEAN / "senior_expres_mezery.csv", media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": 'attachment; filename="dojedeme-kde-chybi-senior-expres.csv"', **MAPA_CACHE})


async def mapa_se_obce_csv(request: Request):
    """Ověřený seznam Senior Expresů ve všech 134 obcích (M-02): má / nemá službu, telefon, podmínky, zdroj a stav ověření."""
    return FileResponse(CLEAN / "senior_expres_obce.csv", media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": 'attachment; filename="dojedeme-senior-expres-obce.csv"', **MAPA_CACHE})


async def mapa_blizko_daleko(request: Request):
    return JSONResponse(_blizko_daleko(), headers=MAPA_CACHE)


DNY_MAPY = {"pd": "", "so": "_so", "ne": "_ne"}


async def mapa_obce(request: Request):
    return FileResponse(CLEAN / "obce.geojson", media_type="application/geo+json", headers=MAPA_CACHE)


def manifest_balicku() -> dict:
    """Manifest z repa; po noční aktualizaci jízdních řádů s novou platností a kontrolním součtem jizdni_rady.zip."""
    m = json.loads((CLEAN / "balicek" / "manifest.json").read_text(encoding="utf-8"))
    info = gtfs_info()
    if info:
        m["jizdni_rady_plati_do"] = info["plati_do"]
        m["verze"] = max(m["verze"], info["verze"])
        for s in m["soubory"]:
            if s["soubor"] == "jizdni_rady.zip":
                s.update(bajtu=info["bajtu"], sha256=info["sha256"])
    return m


async def balicek_manifest(request: Request):
    return JSONResponse(manifest_balicku())


async def balicek_soubor(request: Request):
    """Soubor datového balíčku pro offline režim aplikace (seznam v /balicek/manifest)."""
    nazev = request.path_params["soubor"]
    if nazev not in {f["soubor"] for f in manifest_balicku()["soubory"]}:
        raise Chyba(f"soubor {nazev} v balíčku není")
    if nazev == "jizdni_rady.zip" and gtfs_info():
        return FileResponse(STAV / "gtfs_kk.zip")
    return FileResponse(CLEAN / "balicek" / nazev)


async def chyba(request: Request, exc: Chyba):
    return JSONResponse({"chyba": str(exc)}, status_code=400)


async def nenalezeno(request: Request, exc):
    """Neznámá adresa: prohlížeči stránka s odkazy, aplikacím JSON."""
    if "text/html" in request.headers.get("accept", "") and (WEB / "nenalezeno.html").exists():
        html = re.sub(r"""(/static/[^"'?\s]+\.(?:css|js))(?=["'])""", rf"\1?v={VERZE_WEBU}",
                      (WEB / "nenalezeno.html").read_text(encoding="utf-8"))
        return Response(html, status_code=404, media_type="text/html; charset=utf-8")
    return JSONResponse({"chyba": "nenalezeno"}, status_code=404)


async def neopravneno(request: Request, exc: Opravneni):
    return JSONResponse({"chyba": "Nemáte oprávnění. Přihlaste se (web), nebo pošlete X-Api-Token a X-Profil-Klic."},
                        status_code=403)


app = Starlette(
    routes=[Route("/api", index), Route("/zdravi", zdravi), Route("/cile", cile), Route("/spojeni", spojeni),
            Route("/spojeni/sms", spojeni_sms), Route("/senior-taxi", senior_taxi), Route("/obce", obce_seznam), Route("/obce/{kod_obce}/lekari", obec_lekari), Route("/obce/{kod_obce}", obec),
            Route("/letaky/vsechny.zip", letaky_zip), Route("/letaky/{kod_obce}.pdf", letak_pdf),
            Route("/statistiky", statistiky),
            Route("/mapa/h3", mapa_h3), Route("/mapa/h3.csv", mapa_h3_csv), Route("/mapa/obce", mapa_obce),
            Route("/mapa/spady", mapa_spady), Route("/mapa/spady/souhrn", mapa_spady_souhrn),
            Route("/mapa/blizko-daleko", mapa_blizko_daleko),
            Route("/mapa/senior-expres", mapa_se_mezery), Route("/mapa/senior-expres.csv", mapa_se_mezery_csv),
            Route("/mapa/senior-expres-obce.csv", mapa_se_obce_csv),
            Route("/mapa/pohotovost", mapa_pohotovost), Route("/mapa/pohotovost.csv", mapa_pohotovost_csv),
            Route("/balicek/manifest", balicek_manifest), Route("/balicek/{soubor}", balicek_soubor),
            Route("/sms/gosms/{tajemstvi}", sms_gosms, methods=["POST"]),
            Route("/sms/android/{tajemstvi}", sms_android, methods=["POST"]),
            Route("/sms/twilio/{tajemstvi}", sms_twilio, methods=["POST"]),
            Route("/sms/iphone/{tajemstvi}", sms_iphone, methods=["GET", "POST"]),
            Route("/sms/iphone/{tajemstvi}/fronta", sms_iphone_fronta),
            Route("/sms/iphone/{tajemstvi}/fronta/jedna", sms_iphone_fronta_jedna),
            Route("/sms/simulator", sms_simulator, methods=["POST"]),
            Route("/sms/profil/{telefon}", sms_profil, methods=["GET", "PUT", "DELETE"]),
            Route("/sms/profil/{telefon}/uvod", sms_uvod, methods=["POST"]),
            Route("/sms/profil/{telefon}/overeni", sms_overeni, methods=["POST"]),
            Route("/sms/profil/{telefon}/karticka", sms_karticka),
            Route("/sms/info", sms_info), Route("/sms/log", sms_log), Route("/adresy", adresy),
            Route("/ucet", ucet, methods=["GET", "DELETE"]),
            Route("/ucet/registrace", ucet_registrace, methods=["POST"]),
            Route("/ucet/prihlaseni", ucet_prihlaseni, methods=["POST"]),
            Route("/ucet/odhlaseni", ucet_odhlaseni, methods=["POST"]),
            Route("/ucet/poslat-spoj", ucet_poslat_spoj, methods=["POST"]),
            Route("/ucet/heslo", ucet_heslo, methods=["POST"]),
            Route("/sms/profil/{telefon}/terminy", sms_terminy, methods=["GET", "POST"]),
            Route("/sms/profil/{telefon}/terminy/{id}", sms_termin, methods=["DELETE"]),
            Route("/sms/profil/{telefon}/terminy/{id}/poslat", sms_termin, methods=["POST"]),
            Route("/", stranka("index.html")), Route("/pro-obce", stranka("pro-obce.html")),
            Route("/aplikace", stranka("aplikace.html")), Route("/pro-blizke", stranka("pro-blizke.html")),
            Route("/admin", stranka("admin.html")), Route("/mapa", stranka("mapa.html")),
            Route("/system", stranka("system.html")),
            Mount("/static", app=StaticFiles(directory=WEB / "static", check_dir=False), name="static")],
    middleware=[Middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST", "PUT", "DELETE"],
                           allow_headers=["Content-Type", "X-Api-Token", "X-Profil-Klic", "X-Admin-Token"]),
                Middleware(GZipMiddleware, minimum_size=2000)],   # mapa hexagonů 1,8 MB → ~0,3 MB
    exception_handlers={Chyba: chyba, Opravneni: neopravneno, 404: nenalezeno},
    lifespan=zivotni_cyklus,
)
