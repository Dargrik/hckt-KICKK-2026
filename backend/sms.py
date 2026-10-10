"""SMS služba Dojedeme: senior pošle SMS s textem „*11“ a dostane spoje k cíli 11 (např. „můj zubař“).

- rozpoznej(): tolerantní parser příkazů (`*11`, `11 zitra`, `11 patek 8:00`, `11 15.10.`, překlepy, POMOC, SEZNAM, STOP)
- Uloziste: profily seniorů (telefon → bydliště + zkratky cílů) a log SMS v SQLite
- brány: GoSMS (CZ číslo s odpověďmi), Android telefon s aplikací SMS Gateway (sms-gate.app), simulátor
Texty SMS jsou bez diakritiky a do 306 znaků (design/BRAND.md, kap. 5).
"""
import difflib
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

import httpx
from unidecode import unidecode

DNY = {"pondeli": 0, "utery": 1, "streda": 2, "ctvrtek": 3, "patek": 4, "sobota": 5, "nedele": 6}
DNY_KRATCE = {"po": 0, "ut": 1, "st": 2, "ct": 3, "pa": 4, "so": 5, "ne": 6}
CASTI_DNE = {"rano": 7 * 60, "dopoledne": 9 * 60, "poledne": 12 * 60, "odpoledne": 13 * 60, "vecer": 17 * 60}
DNES = {"dnes", "dneska", "ted", "hned"}
ZITRA = {"zitra", "zejtra", "zitr", "zitrej"}
POZITRI = {"pozitri", "pozejtri"}

TEXT_POMOC = ("Dojedeme: poslete SMS s hvezdickou a cislem cile, napr. *11. Jiny den: *11 zitra, *11 patek, *11 15.10. "
              "Cas: *11 zitra 9:00. Domu: *0. Vase cile: *SEZNAM. Vypnuti: *STOP. "
              "Odebrat blizkemu pravo menit nastaveni: *ZRUSIT.")
TEXT_ZRUSENO = ("Dojedeme: vas blizky uz toto cislo nemuze v systemu upravovat. Sluzba bezi dal a vase cile "
                "zustavaji. Vypnuti sluzby: *STOP. Novemu blizkemu potvrdite cislo kodem.")
TEXT_ZRUSENO_NEOVERENE = ("Dojedeme: nastaveni pro toto cislo jsme smazali. Bez vaseho souhlasu vam nic "
                          "posilat nebudeme.")
TEXT_NEZNAME_CISLO = ("Dojedeme: toto cislo zatim neni nastavene. Pozadejte blizkeho o nastaveni "
                      "v aplikaci Dojedeme. Napoveda: *POMOC.")
TEXT_STOP = "Dojedeme: SMS sluzba je pro toto cislo vypnuta. Znovu zapnete SMS *START."
TEXT_START = "Dojedeme: SMS sluzba je zapnuta. Napiste cislo cile, napr. *11. Napoveda: *POMOC."
TEXT_CEKA_NA_OVERENI = ("Dojedeme: toto cislo ceka na potvrzeni. Poslete SMS s kodem, ktery vidi vas blizky "
                        "v aplikaci Dojedeme, napr. *1234.")


def normalizuj_telefon(t: str) -> str:
    d = re.sub(r"[^\d+]", "", t or "")
    if d.startswith("00"):
        d = "+" + d[2:]
    if re.fullmatch(r"\d{9}", d):
        d = "+420" + d
    if re.fullmatch(r"420\d{9}", d):
        d = "+" + d
    return d


# --- parser ----------------------------------------------------------------------
@dataclass
class Prikaz:
    typ: str                    # spoj | pomoc | seznam | stop | start | nerozumim
    kod: str | None = None      # zkratka cíle, např. "11"
    datum: date | None = None   # None = nejbližší rozumný den
    od_min: int | None = None   # čas odjezdu od (minuty od půlnoci)


def _den_v_tydnu(wd: int, dnes: date) -> date:
    return dnes + timedelta(days=(wd - dnes.weekday()) % 7)


def rozpoznej(text: str, dnes: date) -> Prikaz:
    t = unidecode(text or "").lower()
    t = re.sub(r"[,;!?()\"']", " ", t).strip()
    holy = re.sub(r"[\s*#.]", "", t)
    if holy in ("pomoc", "help", "napoveda", "info", "") or t.strip() == "?":
        return Prikaz("pomoc")
    if holy in ("stop", "konec", "odhlasit"):
        return Prikaz("stop")
    if holy in ("zrusit", "odpojit", "zrusitblizkeho", "zrusitpristup"):
        return Prikaz("zrusit")     # senior odebere blízkému právo měnit nastavení (služba běží dál)
    if holy in ("start", "zapnout", "prihlasit"):
        return Prikaz("start")
    if holy in ("seznam", "cile", "list", "menu"):
        return Prikaz("seznam")
    # „jedu domů“: *0, 0, DOMU, *0 11 (domů od místa 11)
    m = re.fullmatch(r"[*#]?\s*0(?:\s+[*#]?\s*(\d{1,3}))?\s*[.]?", t)
    if m or holy in ("domu", "domov", "zpet", "jedudomu", "chcidomu", "domuprosim"):
        return Prikaz("domu", kod=str(int(m[1])) if m and m[1] else None)

    datum, od = None, None
    # čas: 8:00, 8h00, „v 8“, „od 9“
    m = re.search(r"(?<![\d.])(\d{1,2})\s*[:h]\s*(\d{2})(?!\d)", t)
    if m and int(m[1]) < 24 and int(m[2]) < 60:
        od = int(m[1]) * 60 + int(m[2])
        t = t[:m.start()] + " " + t[m.end():]
    else:
        m = re.search(r"\b(?:v|ve|od|kolem)\s+(\d{1,2})\b(?!\s*[./]\s*\d)", t)
        if m and 4 <= int(m[1]) <= 22:
            od = int(m[1]) * 60
            t = t[:m.start()] + " " + t[m.end():]
    # datum: 15.10. / 15. 10. / 15/10 / 15.10.2026
    m = re.search(r"(?<![\d:])(\d{1,2})\s*[./]\s*(\d{1,2})\s*\.?(?:\s*(\d{4}))?(?![\d:])", t)
    if m and 1 <= int(m[2]) <= 12 and 1 <= int(m[1]) <= 31:
        try:
            rok = int(m[3]) if m[3] else dnes.year
            datum = date(rok, int(m[2]), int(m[1]))
            if not m[3] and datum < dnes:
                datum = date(rok + 1, int(m[2]), int(m[1]))
            t = t[:m.start()] + " " + t[m.end():]
        except ValueError:
            pass
    # kód cíle: první samostatné číslo (volitelně s * nebo #)
    kod = None
    m = re.search(r"(?:^|\s)[*#]?\s*(\d{1,3})(?=\s|$|\.)", t)
    if m:
        kod = str(int(m[1]))
        t = t[:m.start()] + " " + t[m.end():]
    # slovní den a část dne
    for tok in t.split():
        tok = tok.strip(".*#")
        if tok in DNES:
            datum = datum or dnes
        elif tok in ZITRA or difflib.get_close_matches(tok, ["zitra"], n=1, cutoff=0.8):
            datum = datum or dnes + timedelta(days=1)
        elif tok in POZITRI:
            datum = datum or dnes + timedelta(days=2)
        elif tok in CASTI_DNE:
            od = od if od is not None else CASTI_DNE[tok]
        elif tok in DNY_KRATCE and kod:
            datum = datum or _den_v_tydnu(DNY_KRATCE[tok], dnes)
        else:
            shoda = difflib.get_close_matches(tok, list(DNY), n=1, cutoff=0.75) if len(tok) >= 3 else []
            if shoda:
                datum = datum or _den_v_tydnu(DNY[shoda[0]], dnes)
    if not kod:
        return Prikaz("nerozumim", datum=datum, od_min=od)
    return Prikaz("spoj", kod=kod, datum=datum, od_min=od)


# --- úložiště ----------------------------------------------------------------------
SCHEMA = """
create table if not exists profily (
  telefon text primary key, bydliste_lat real not null, bydliste_lon real not null, bydliste_popis text,
  aktivni integer not null default 1, souhlas_od text not null, upraveno text not null);
create table if not exists zkratky (
  telefon text not null references profily(telefon) on delete cascade, kod text not null,
  cil_id text not null, popis text, primary key (telefon, kod));
create table if not exists sms_log (
  id integer primary key autoincrement, cas text not null, smer text not null, telefon text not null,
  text text not null, brana text not null, ext_id text, stav text);
create unique index if not exists sms_log_ext on sms_log(brana, ext_id) where ext_id is not null and smer = 'in';
create table if not exists uzivatele (
  id integer primary key autoincrement, email text not null unique, heslo_hash text not null, vytvoreno text not null);
create table if not exists relace (
  token_hash text primary key, uzivatel_id integer not null references uzivatele(id) on delete cascade,
  vytvoreno text not null, plati_do text not null);
create table if not exists terminy (
  id integer primary key autoincrement, telefon text not null, cil_id text not null, popis text,
  datum text not null, cas text not null, vytvoreno text not null, odeslano text, stav text);
create table if not exists sms_fronta (
  id integer primary key autoincrement, telefon text not null, text text not null,
  vytvoreno text not null, predano text);
"""
RELACE_DNI = 30


def hash_hesla(heslo: str) -> str:
    """scrypt s náhodnou solí; uloží se jen výsledek (parametry$sůl$hash)."""
    sul = os.urandom(16)
    h = hashlib.scrypt(heslo.encode(), salt=sul, n=2 ** 14, r=8, p=1, dklen=32)
    return f"scrypt$16384$8$1${sul.hex()}${h.hex()}"


def heslo_sedi(heslo: str, ulozeny: str) -> bool:
    try:
        _, n, r, p, sul, h = ulozeny.split("$")
        vypocet = hashlib.scrypt(heslo.encode(), salt=bytes.fromhex(sul), n=int(n), r=int(r), p=int(p), dklen=len(h) // 2)
        return hmac.compare_digest(vypocet.hex(), h)
    except (ValueError, TypeError):
        return False


class Uloziste:
    def __init__(self, cesta: Path):
        cesta.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(cesta, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("pragma foreign_keys = on")
        self.db.executescript(SCHEMA)
        sloupce = {r["name"] for r in self.db.execute("pragma table_info(profily)")}
        for sloupec, typ in [("klic_hash", "text"),                 # klíč správce profilu (blízký, který profil založil)
                             ("overeno", "integer not null default 1"),  # senior potvrdil číslo SMS kódem
                             ("overovaci_kod", "text"), ("kod_plati_do", "text"),
                             ("vlastnik_id", "integer")]:           # účet blízkého, který profil spravuje
            if sloupec not in sloupce:   # migrace
                self.db.execute(f"alter table profily add column {sloupec} {typ}")
        self.db.commit()

    # --- účty blízkých -------------------------------------------------------------
    def registruj(self, email: str, heslo: str) -> int | None:
        """Nový účet; None, když e-mail už je zaregistrovaný."""
        try:
            with self.db:
                c = self.db.execute("insert into uzivatele(email, heslo_hash, vytvoreno) values (?,?,?)",
                                    (email, hash_hesla(heslo), datetime.now().isoformat(timespec="seconds")))
            return c.lastrowid
        except sqlite3.IntegrityError:
            return None

    def prihlas(self, email: str, heslo: str) -> int | None:
        r = self.db.execute("select id, heslo_hash from uzivatele where email = ?", (email,)).fetchone()
        if not r:
            hash_hesla(heslo)   # stejně dlouhý výpočet i pro neexistující e-mail (nedá se zjistit, kdo má účet)
            return None
        return r["id"] if heslo_sedi(heslo, r["heslo_hash"]) else None

    def nova_relace(self, uzivatel_id: int) -> str:
        token = secrets.token_urlsafe(32)
        ted = datetime.now()
        with self.db:
            self.db.execute("delete from relace where plati_do < ?", (ted.isoformat(timespec="seconds"),))
            self.db.execute("insert into relace(token_hash, uzivatel_id, vytvoreno, plati_do) values (?,?,?,?)",
                            (self._hash(token), uzivatel_id, ted.isoformat(timespec="seconds"),
                             (ted + timedelta(days=RELACE_DNI)).isoformat(timespec="seconds")))
        return token

    def uzivatel_relace(self, token: str | None) -> dict | None:
        if not token:
            return None
        r = self.db.execute("select u.id, u.email from relace r join uzivatele u on u.id = r.uzivatel_id "
                            "where r.token_hash = ? and r.plati_do >= ?",
                            (self._hash(token), datetime.now().isoformat(timespec="seconds"))).fetchone()
        return dict(r) if r else None

    def zrus_relaci(self, token: str | None):
        if token:
            with self.db:
                self.db.execute("delete from relace where token_hash = ?", (self._hash(token),))

    def zmen_heslo(self, uzivatel_id: int, nove_heslo: str, ponechat_token: str | None = None):
        """Nové heslo; ostatní přihlášení (jiná zařízení) se zruší, aktuální relace zůstane."""
        with self.db:
            self.db.execute("update uzivatele set heslo_hash = ? where id = ?", (hash_hesla(nove_heslo), uzivatel_id))
            self.db.execute("delete from relace where uzivatel_id = ? and token_hash != ?",
                            (uzivatel_id, self._hash(ponechat_token) if ponechat_token else ""))

    def smaz_ucet(self, uzivatel_id: int) -> list[str]:
        """Smaže účet, jeho relace i všechny profily seniorů, které spravoval (vrací jejich telefony)."""
        telefony = [r["telefon"] for r in self.db.execute("select telefon from profily where vlastnik_id = ?", (uzivatel_id,))]
        for t in telefony:
            self.smaz_profil(t)
        with self.db:
            self.db.execute("delete from uzivatele where id = ?", (uzivatel_id,))
        return telefony

    def nastav_vlastnika(self, telefon: str, uzivatel_id: int):
        with self.db:
            self.db.execute("update profily set vlastnik_id = ? where telefon = ?", (uzivatel_id, telefon))

    def ma_klic(self, telefon: str) -> bool:
        r = self.db.execute("select klic_hash from profily where telefon = ?", (telefon,)).fetchone()
        return bool(r and r["klic_hash"])

    def odpoj_spravce(self, telefon: str):
        """SMS ZRUSIT: blízký (účet i klíč z aplikace) přestane profil spravovat, jeho plánované termíny zmizí.
        Profil zůstane bez správce; převzít ho může jiný blízký, ale senior musí znovu potvrdit číslo kódem."""
        with self.db:
            self.db.execute("update profily set vlastnik_id = null, klic_hash = null where telefon = ?", (telefon,))
            self.db.execute("delete from terminy where telefon = ? and odeslano is null", (telefon,))

    def vlastnik(self, telefon: str) -> int | None:
        r = self.db.execute("select vlastnik_id from profily where telefon = ?", (telefon,)).fetchone()
        return r["vlastnik_id"] if r else None

    def profily_uzivatele(self, uzivatel_id: int) -> list[dict]:
        return [self.profil(r["telefon"]) for r in
                self.db.execute("select telefon from profily where vlastnik_id = ? order by upraveno desc", (uzivatel_id,))]

    # --- ověření čísla seniora ---------------------------------------------------------
    def zahaj_overeni(self, telefon: str) -> dict:
        """Nový 4místný kód, který senior pošle ze svého telefonu (*1234). Do potvrzení služba neodpovídá spoji."""
        kod = f"{secrets.randbelow(9000) + 1000}"
        plati_do = (datetime.now() + timedelta(hours=48)).isoformat(timespec="seconds")
        with self.db:
            self.db.execute("update profily set overeno = 0, overovaci_kod = ?, kod_plati_do = ? where telefon = ?",
                            (kod, plati_do, telefon))
        return {"kod": kod, "sms": f"*{kod}", "plati_do": plati_do}

    def over_kod(self, telefon: str, kod: str) -> bool:
        r = self.db.execute("select overovaci_kod, kod_plati_do from profily where telefon = ?", (telefon,)).fetchone()
        if not r or not r["overovaci_kod"] or r["kod_plati_do"] < datetime.now().isoformat(timespec="seconds"):
            return False
        if not hmac.compare_digest(r["overovaci_kod"], kod):
            return False
        with self.db:
            self.db.execute("update profily set overeno = 1, overovaci_kod = null, kod_plati_do = null where telefon = ?",
                            (telefon,))
        return True

    @staticmethod
    def _hash(klic: str) -> str:
        return hashlib.sha256(klic.encode()).hexdigest()

    def novy_klic(self, telefon: str) -> str:
        """Vygeneruje nový klíč správce profilu; uloží se jen jeho hash, klíč dostane aplikace jednou."""
        klic = secrets.token_urlsafe(18)
        with self.db:
            self.db.execute("update profily set klic_hash = ? where telefon = ?", (self._hash(klic), telefon))
        return klic

    def klic_sedi(self, telefon: str, klic: str | None) -> bool:
        r = self.db.execute("select klic_hash from profily where telefon = ?", (telefon,)).fetchone()
        return bool(r and r["klic_hash"] and klic and hmac.compare_digest(r["klic_hash"], self._hash(klic)))

    def uloz_profil(self, telefon: str, lat: float, lon: float, popis: str | None, zkratky: list[dict]):
        ted = datetime.now().isoformat(timespec="seconds")
        with self.db:
            self.db.execute("insert into profily(telefon, bydliste_lat, bydliste_lon, bydliste_popis, souhlas_od, upraveno) "
                            "values (?,?,?,?,?,?) on conflict(telefon) do update set bydliste_lat=excluded.bydliste_lat, "
                            "bydliste_lon=excluded.bydliste_lon, bydliste_popis=excluded.bydliste_popis, upraveno=excluded.upraveno",
                            (telefon, lat, lon, popis, ted, ted))
            self.db.execute("delete from zkratky where telefon = ?", (telefon,))
            self.db.executemany("insert into zkratky(telefon, kod, cil_id, popis) values (?,?,?,?)",
                                [(telefon, str(z["kod"]).lstrip("*"), z["cil_id"], z.get("popis")) for z in zkratky])

    def profil(self, telefon: str) -> dict | None:
        p = self.db.execute("select * from profily where telefon = ?", (telefon,)).fetchone()
        if not p:
            return None
        z = self.db.execute("select kod, cil_id, popis from zkratky where telefon = ? order by cast(kod as integer)",
                            (telefon,)).fetchall()
        out = {**dict(p), "aktivni": bool(p["aktivni"]), "overeno": bool(p["overeno"]), "zkratky": [dict(r) for r in z]}
        for tajne in ("klic_hash", "overovaci_kod", "vlastnik_id"):
            out.pop(tajne, None)
        return out

    def cekajici_overeni(self, telefon: str) -> dict | None:
        """Platný kód, který ještě čeká na SMS od seniora (vidí ho jen správce profilu)."""
        r = self.db.execute("select overovaci_kod, kod_plati_do from profily where telefon = ? and overeno = 0",
                            (telefon,)).fetchone()
        if not r or not r["overovaci_kod"] or r["kod_plati_do"] < datetime.now().isoformat(timespec="seconds"):
            return None
        return {"kod": r["overovaci_kod"], "sms": f"*{r['overovaci_kod']}", "plati_do": r["kod_plati_do"]}

    def smaz_profil(self, telefon: str) -> bool:
        with self.db:   # se smazáním profilu zmizí i historie SMS toho čísla (osobní údaje nedržíme déle, než je třeba)
            self.db.execute("delete from sms_log where telefon = ?", (telefon,))
            self.db.execute("delete from terminy where telefon = ?", (telefon,))
            return self.db.execute("delete from profily where telefon = ?", (telefon,)).rowcount > 0

    def nastav_aktivni(self, telefon: str, aktivni: bool):
        with self.db:
            self.db.execute("update profily set aktivni = ? where telefon = ?", (int(aktivni), telefon))

    def zaloguj(self, smer: str, telefon: str, text: str, brana: str, ext_id: str | None = None, stav: str | None = None) -> bool:
        """Vrací False, pokud příchozí zpráva se stejným ext_id už byla zpracována (brány opakují webhooky)."""
        try:
            with self.db:
                self.db.execute("insert into sms_log(cas, smer, telefon, text, brana, ext_id, stav) values (?,?,?,?,?,?,?)",
                                (datetime.now().isoformat(timespec="seconds"), smer, telefon, text, brana, ext_id, stav))
            return True
        except sqlite3.IntegrityError:
            return False

    # --- termíny u lékaře: večer předem přijde SMS se spojem, který dorazí včas ---
    def pridej_termin(self, telefon: str, cil_id: str, popis: str | None, datum: str, cas: str) -> int:
        with self.db:
            return self.db.execute(
                "insert into terminy(telefon, cil_id, popis, datum, cas, vytvoreno) values (?,?,?,?,?,?)",
                (telefon, cil_id, popis, datum, cas, datetime.now().isoformat(timespec="seconds"))).lastrowid

    def terminy(self, telefon: str, od_data: str) -> list[dict]:
        return [dict(r) for r in self.db.execute(
            "select * from terminy where telefon = ? and datum >= ? order by datum, cas", (telefon, od_data))]

    def termin(self, telefon: str, id_: int) -> dict | None:
        r = self.db.execute("select * from terminy where telefon = ? and id = ?", (telefon, id_)).fetchone()
        return dict(r) if r else None

    def smaz_termin(self, telefon: str, id_: int) -> bool:
        with self.db:
            return self.db.execute("delete from terminy where telefon = ? and id = ?", (telefon, id_)).rowcount > 0

    def terminy_k_odeslani(self, datum: str) -> list[dict]:
        return [dict(r) for r in self.db.execute(
            "select * from terminy where datum = ? and odeslano is null order by id", (datum,))]

    def oznac_termin(self, id_: int, stav: str):
        with self.db:
            self.db.execute("update terminy set odeslano = ?, stav = ? where id = ?",
                            (datetime.now().isoformat(timespec="seconds"), stav, id_))

    # --- fronta odchozích SMS pro bránu přes iPhone (iPhone si je vyzvedne, server ho sám probudit neumí) ---
    def do_fronty(self, telefon: str, text: str) -> int:
        with self.db:
            return self.db.execute("insert into sms_fronta(telefon, text, vytvoreno) values (?,?,?)",
                                   (telefon, text, datetime.now().isoformat(timespec="seconds"))).lastrowid

    def vyzvedni_frontu(self, limit: int = 10) -> list[dict]:
        """Zprávy, které iPhone ještě nepřevzal; převzetím se označí (pošlou se nejvýš jednou)."""
        with self.db:
            radky = [dict(r) for r in self.db.execute(
                "select id, telefon, text from sms_fronta where predano is null order by id limit ?", (limit,))]
            ted = datetime.now().isoformat(timespec="seconds")
            for r in radky:
                self.db.execute("update sms_fronta set predano = ? where id = ?", (ted, r["id"]))
        return radky

    def ceka_ve_fronte(self) -> int:
        return self.db.execute("select count(*) from sms_fronta where predano is null").fetchone()[0]

    def odeslano_dnes(self, telefon: str) -> int:
        return self.db.execute("select count(*) from sms_log where smer = 'out' and telefon = ? and cas >= ?",
                               (telefon, date.today().isoformat())).fetchone()[0]

    def log(self, telefon: str | None = None, limit: int = 50) -> list[dict]:
        q = "select * from sms_log" + (" where telefon = ?" if telefon else "") + " order by id desc limit ?"
        return [dict(r) for r in self.db.execute(q, ((telefon, limit) if telefon else (limit,))).fetchall()]


# --- brány ------------------------------------------------------------------------
class Simulator:
    nazev = "simulator"

    async def posli(self, telefon: str, text: str) -> str:
        return "simulace (neodeslano)"


class IphoneFronta:
    """Odchozí SMS přes iPhone služby: zpráva čeká ve frontě, zkratka v iPhonu si ji vyzvedne
    (GET /sms/iphone/{tajemstvi}/fronta) a odešle akcí „Odeslat zprávu“. Návod: backend/deploy/iphone-zkratka.md."""
    nazev = "iphone"

    def __init__(self, uloziste: "Uloziste"):
        self.uloziste = uloziste

    async def posli(self, telefon: str, text: str) -> str:
        return f"ve fronte iPhonu ({self.uloziste.do_fronty(telefon, text)})"


class GoSMS:
    """GoSMS.cz REST API: OAuth2 client_credentials, POST /v1/messages (doc.gosms.eu)."""
    nazev = "gosms"
    API = "https://app.gosms.eu"

    def __init__(self, client_id: str, client_secret: str, kanal: int, jen_test: bool = False):
        self.client_id, self.client_secret, self.kanal, self.jen_test = client_id, client_secret, kanal, jen_test
        self._token, self._platnost = None, 0.0

    async def _token_platny(self, c: httpx.AsyncClient) -> str:
        if not self._token or time.time() > self._platnost - 60:
            r = await c.get(f"{self.API}/oauth/v2/token", params={
                "client_id": self.client_id, "client_secret": self.client_secret, "grant_type": "client_credentials"})
            r.raise_for_status()
            j = r.json()
            self._token, self._platnost = j["access_token"], time.time() + int(j.get("expires_in", 3600))
        return self._token

    async def posli(self, telefon: str, text: str) -> str:
        async with httpx.AsyncClient(timeout=20) as c:
            token = await self._token_platny(c)
            url = f"{self.API}/api/v1/messages" + ("/test" if self.jen_test else "")
            r = await c.post(url, json={"message": text, "recipients": telefon, "channel": self.kanal},
                             headers={"Authorization": f"Bearer {token}"})
            r.raise_for_status()
            return ("test: " if self.jen_test else "") + str(r.json().get("link") or r.json().get("price") or r.status_code)


class AndroidSmsGate:
    """Android telefon s aplikací SMS Gateway for Android (sms-gate.app), cloud nebo lokální režim."""
    nazev = "android"

    def __init__(self, uzivatel: str, heslo: str, url: str = "https://api.sms-gate.app/3rdparty/v1"):
        self.auth, self.url = (uzivatel, heslo), url.rstrip("/")

    async def posli(self, telefon: str, text: str) -> str:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post(f"{self.url}/messages", auth=self.auth,
                             json={"phoneNumbers": [telefon], "textMessage": {"text": text}})
            r.raise_for_status()
            return str(r.json().get("id", r.status_code))


class Twilio:
    """Twilio Programmable Messaging. Odpověď na příchozí SMS jde přímo v odpovědi webhooku (TwiML),
    API se používá jen pro zprávy, které posíláme sami (uvítací SMS, simulátor s odesláním)."""
    nazev = "twilio"

    def __init__(self, account_sid: str, auth_token: str, cislo: str):
        self.sid, self.token, self.cislo = account_sid, auth_token, cislo

    async def posli(self, telefon: str, text: str) -> str:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post(f"https://api.twilio.com/2010-04-01/Accounts/{self.sid}/Messages.json",
                             auth=(self.sid, self.token), data={"To": telefon, "From": self.cislo, "Body": text})
            r.raise_for_status()
            return r.json().get("sid", str(r.status_code))


def twiml(text: str | None) -> str:
    from xml.sax.saxutils import escape
    zprava = f"<Message>{escape(text)}</Message>" if text else ""
    return f'<?xml version="1.0" encoding="UTF-8"?><Response>{zprava}</Response>'


def over_podpis_twilio(auth_token: str, url: str, parametry: dict, podpis: str | None) -> bool:
    """X-Twilio-Signature = base64(HMAC-SHA1(token, URL + klíče a hodnoty POST parametrů seřazené podle klíče))."""
    import base64
    if not podpis:
        return False
    data = url + "".join(k + parametry[k] for k in sorted(parametry))
    ocekavany = base64.b64encode(hmac.new(auth_token.encode(), data.encode(), hashlib.sha1).digest()).decode()
    return hmac.compare_digest(ocekavany, podpis)


def over_podpis_android(klic: str, telo: bytes, podpis: str | None, cas: str | None) -> bool:
    """X-Signature = HMAC-SHA256(tělo + X-Timestamp) hex, časové razítko max. ±5 min (docs.sms-gate.app)."""
    if not podpis or not cas or abs(time.time() - int(cas)) > 300:
        return False
    ocekavany = hmac.new(klic.encode(), telo + cas.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(ocekavany, podpis)
