"""Vyhledávání spojení veřejnou dopravou v Karlovarském kraji (Connection Scan Algorithm).

Stejný algoritmus jako analýza dostupnosti v data/scripts/dostupnost.py, navíc s rekonstrukcí cesty
(úseky pěšky / autobusem / vlakem, linky, mezizastávky), aby šlo spojení ukázat v aplikaci a poslat SMS.

Data: data/clean/gtfs_kk.zip (oříznuté GTFS kraje, vytváří data/scripts/gtfs_kk.py)
"""
import bisect
import io
import math
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

GTFS_ZIP = Path(__file__).resolve().parents[1] / "data" / "clean" / "gtfs_kk.zip"

CHUZE_M_ZA_MIN = 60     # 3,6 km/h – pomalejší chůze seniora
OKLIKA = 1.3            # vzdušná vzdálenost × 1,3 ≈ cesta po chodníku
MAX_PESKY_M = 1000      # max. pěšky z místa na zastávku a ze zastávky do cíle
PRESTUP_M = 300         # max. pěší přestup mezi zastávkami
MIN_PRESTUP = 2         # minut na přestup mezi dvěma spoji
MAX_CESTA = 4 * 60      # hledáme cesty do 4 h
KONEC_DNE = 23 * 60     # seznam cílů hledá první spoj až do 23:00
INF = 10 ** 9
DRUH = {"0": "tramvaj", "2": "vlak", "3": "bus", "11": "trolejbus", "100": "vlak", "700": "bus", "800": "trolejbus"}


def druh(route_type) -> str:
    """GTFS route_type → vlak / bus / tramvaj / trolejbus (i rozšířené kódy: 100–199 železnice, 800–899 trolejbus…)."""
    try:
        t = int(float(route_type))
    except (TypeError, ValueError):
        return "bus"
    if t == 2 or 100 <= t < 200:
        return "vlak"
    if t == 0 or 900 <= t < 1000:
        return "tramvaj"
    if t == 11 or 800 <= t < 900:
        return "trolejbus"
    return "bus"


def haversine_m(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(np.radians, (lat1, lon1, lat2, lon2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 6371000 * 2 * np.arcsin(np.sqrt(a))


def hm(t: str) -> int:
    h, m, *_ = t.split(":")
    return int(h) * 60 + int(m)


def fmt(t: int) -> str:
    return f"{t // 60 % 24}:{t % 60:02d}"


def slouc_pesky(useky: list[dict]) -> list[dict]:
    """Sloučí po sobě jdoucí pěší úseky (např. přestup + dojití do cíle) do jednoho."""
    out = []
    for u in useky:
        if u["typ"] == "pesky" and out and out[-1]["typ"] == "pesky":
            out[-1] = {"typ": "pesky", "z": out[-1].get("z"), "do": u.get("do"), "minut": out[-1]["minut"] + u["minut"]}
        else:
            out.append(u)
    return [{k: v for k, v in u.items() if v is not None} for u in out]


@dataclass
class Den:
    """Spoje jednoho dne seřazené podle odjezdu (connections) + zastávky každého spoje."""
    datum: str
    dep_t: list = field(default_factory=list)
    arr_t: list = field(default_factory=list)
    dep_s: list = field(default_factory=list)
    arr_s: list = field(default_factory=list)
    trip: list = field(default_factory=list)       # index spoje v trip_ids
    pos: list = field(default_factory=list)        # pořadí úseku ve spoji (index do trip_stops)
    trip_ids: list = field(default_factory=list)
    trip_stops: list = field(default_factory=list)  # pro každý spoj: [(zastávka, příjezd, odjezd), …]


class Router:
    def __init__(self, gtfs_zip: Path = GTFS_ZIP):
        z = zipfile.ZipFile(gtfs_zip)
        rd = lambda n: pd.read_csv(io.TextIOWrapper(z.open(n), encoding="utf-8"), dtype=str)  # noqa: E731
        stops = rd("stops.txt")
        if "location_type" in stops:
            stops = stops[stops["location_type"].fillna("0") != "1"]
        self.stop_ids = stops["stop_id"].tolist()
        self.idx = {s: i for i, s in enumerate(self.stop_ids)}
        self.names = stops["stop_name"].tolist()
        self.lat = stops["stop_lat"].astype(float).values
        self.lon = stops["stop_lon"].astype(float).values
        n = len(self.stop_ids)

        st = rd("stop_times.txt")[["trip_id", "stop_id", "stop_sequence", "arrival_time", "departure_time"]]
        st = st[st["stop_id"].isin(self.idx)].copy()
        st["seq"] = st["stop_sequence"].astype(int)
        st["arr"] = st["arrival_time"].fillna(st["departure_time"]).map(hm)
        st["dep"] = st["departure_time"].fillna(st["arrival_time"]).map(hm)
        st["s"] = st["stop_id"].map(self.idx)
        self.stop_times = st.sort_values(["trip_id", "seq"])[["trip_id", "s", "arr", "dep"]]

        trips = rd("trips.txt")
        routes = rd("routes.txt")
        agency = rd("agency.txt")
        r = routes.merge(agency[["agency_id", "agency_name"]], on="agency_id", how="left") if "agency_id" in routes else routes
        t = trips.merge(r, on="route_id", how="left")
        self.trip_meta = t.set_index("trip_id")[[c for c in ["service_id", "route_short_name", "route_long_name",
                                                             "route_type", "trip_headsign", "agency_name"] if c in t]]
        self.calendar = rd("calendar.txt") if "calendar.txt" in z.namelist() else None
        self.calendar_dates = rd("calendar_dates.txt") if "calendar_dates.txt" in z.namelist() else None

        # pěší přestupy mezi zastávkami
        self.foot = [[] for _ in range(n)]
        for i in range(n):
            d = haversine_m(self.lat[i], self.lon[i], self.lat, self.lon) * OKLIKA
            for j in np.nonzero((d <= PRESTUP_M) & (np.arange(n) != i))[0]:
                self.foot[i].append((int(j), int(math.ceil(d[j] / CHUZE_M_ZA_MIN))))

    # --- kalendář a spoje dne -------------------------------------------------------
    def aktivni_sluzby(self, day: str) -> set:
        wd = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"][
            datetime.strptime(day, "%Y%m%d").weekday()]
        act = set()
        if self.calendar is not None:
            c = self.calendar
            act = set(c[(c["start_date"] <= day) & (c["end_date"] >= day) & (c[wd] == "1")]["service_id"])
        if self.calendar_dates is not None:
            cd = self.calendar_dates[self.calendar_dates["date"] == day]
            act |= set(cd[cd["exception_type"] == "1"]["service_id"])
            act -= set(cd[cd["exception_type"] == "2"]["service_id"])
        return act

    @lru_cache(maxsize=8)
    def den(self, day: str) -> Den:
        act = self.aktivni_sluzby(day)
        trips = set(self.trip_meta.index[self.trip_meta["service_id"].isin(act)])
        st = self.stop_times[self.stop_times["trip_id"].isin(trips)]
        d = Den(datum=day)
        conns = []
        for ti, (trip_id, g) in enumerate(st.groupby("trip_id", sort=False)):
            rows = list(zip(g["s"], g["arr"], g["dep"]))
            d.trip_ids.append(trip_id)
            d.trip_stops.append(rows)
            for p in range(len(rows) - 1):
                conns.append((rows[p][2], rows[p + 1][1], rows[p][0], rows[p + 1][0], ti, p))
        conns.sort()
        if conns:
            d.dep_t, d.arr_t, d.dep_s, d.arr_s, d.trip, d.pos = map(list, zip(*conns))
        return d

    # --- přístup pěšky ----------------------------------------------------------------
    def zastavky_v_dosahu(self, lat: float, lon: float, max_m: int = MAX_PESKY_M) -> dict[int, int]:
        """{zastávka: minut pěšky} do max_m po chodníku."""
        d = haversine_m(lat, lon, self.lat, self.lon) * OKLIKA
        return {int(i): int(math.ceil(d[i] / CHUZE_M_ZA_MIN)) for i in np.nonzero(d <= max_m)[0]}

    # --- CSA s ukazateli pro rekonstrukci cesty ----------------------------------------
    def csa(self, d: Den, sources: dict[int, int], t0: int, t_max: int, cile: dict[int, int] | None = None):
        n = len(self.stop_ids)
        arr = [INF] * n
        via: list = [None] * n         # ("start",) | ("spoj", vstupní úsek, výstupní úsek) | ("pesky", odkud, minut)
        for s, t in sources.items():
            arr[s], via[s] = t, ("start",)
        enter: dict[int, int] = {}
        best_cil = INF
        for k in range(bisect.bisect_left(d.dep_t, t0), len(d.dep_t)):
            dep = d.dep_t[k]
            if dep > t_max or dep >= best_cil:   # dál už se do cíle dřív nedostaneme
                break
            tr = d.trip[k]
            if tr not in enter:
                s = d.dep_s[k]
                ready = arr[s] + (MIN_PRESTUP if via[s] and via[s][0] != "start" else 0)
                if ready > dep:
                    continue
                enter[tr] = k
            a, at = d.arr_s[k], d.arr_t[k]
            if at < arr[a]:
                arr[a], via[a] = at, ("spoj", enter[tr], k)
                if cile and a in cile:
                    best_cil = min(best_cil, at + cile[a])
                for j, w in self.foot[a]:
                    if at + w < arr[j]:
                        arr[j], via[j] = at + w, ("pesky", a, w)
                        if cile and j in cile:
                            best_cil = min(best_cil, at + w + cile[j])
        return arr, via

    def _useky(self, d: Den, via: list, cil_s: int) -> tuple[list[dict], int]:
        """Úseky cesty do zastávky cil_s a výchozí zastávka (kam se šlo pěšky z domova)."""
        out, s = [], cil_s
        while via[s][0] != "start":
            v = via[s]
            if v[0] == "pesky":
                out.append({"typ": "pesky", "z": self._zast(v[1]), "do": self._zast(s), "minut": v[2]})
                s = v[1]
            else:
                e, x = v[1], v[2]
                tr = d.trip[e]
                stops = d.trip_stops[tr][d.pos[e]:d.pos[x] + 2]
                m = self.trip_meta.loc[d.trip_ids[tr]]
                out.append({
                    "typ": druh(m.get("route_type")),
                    "linka": m.get("route_short_name") if pd.notna(m.get("route_short_name")) else m.get("route_long_name"),
                    "smer": m.get("trip_headsign") if pd.notna(m.get("trip_headsign")) else self.names[d.trip_stops[tr][-1][0]],
                    "dopravce": m.get("agency_name") if pd.notna(m.get("agency_name")) else None,
                    "z": self._zast(d.dep_s[e]), "do": self._zast(d.arr_s[x]),
                    "odjezd": fmt(d.dep_t[e]), "prijezd": fmt(d.arr_t[x]),
                    "mezizastavky": [{"nazev": self.names[si], "cas": fmt(a_)} for si, a_, _ in stops[1:-1]],
                })
                s = d.dep_s[e]
        return out[::-1], s

    def _zast(self, s: int) -> dict:
        return {"nazev": self.names[s], "lat": round(float(self.lat[s]), 6), "lon": round(float(self.lon[s]), 6)}

    # --- veřejné funkce -----------------------------------------------------------------
    def spojeni(self, z: tuple[float, float], do: tuple[float, float], datum: date, od_min: int,
                pocet: int = 3, do_min: int | None = None) -> list[dict]:
        """Až `pocet` spojení z bodu `z` do bodu `do` odjíždějících od `od_min` (minuty od půlnoci)."""
        d = self.den(datum.strftime("%Y%m%d"))
        pristup = self.zastavky_v_dosahu(*z)
        odchod = self.zastavky_v_dosahu(*do)
        pesky = []
        primo_m = float(haversine_m(z[0], z[1], do[0], do[1])) * OKLIKA
        if primo_m <= MAX_PESKY_M:   # cíl je blízko – nabídneme i cestu pěšky
            m = math.ceil(primo_m / CHUZE_M_ZA_MIN)
            pesky = [{"odjezd": fmt(od_min), "prijezd": fmt(od_min + m), "minut": m, "prestupy": 0,
                      "useky": [{"typ": "pesky", "minut": m, "metru": round(primo_m)}]}]
        out = []
        t = od_min
        limit = do_min if do_min is not None else od_min + 24 * 60
        while pristup and odchod and len(out) < pocet and t < limit:
            sources = {s: t + w for s, w in pristup.items()}
            arr, via = self.csa(d, sources, t, t + MAX_CESTA, odchod)
            cand = [(arr[s] + w, s) for s, w in odchod.items() if arr[s] < INF and via[s][0] != "start"]
            if not cand:
                # v tomto okně nic nejede (např. odpolední mezera mezi spoji) – posunout okno, ne skončit;
                # okna se překrývají o půlku, takže se najde i delší cesta začínající na konci okna
                t += MAX_CESTA // 2
                continue
            prijezd, s_cil = min(cand)
            useky, s_start = self._useky(d, via, s_cil)
            jizdy = [u for u in useky if u["typ"] != "pesky"]
            pesky_tam = pristup[s_start]
            odchod_z_domu = hm(jizdy[0]["odjezd"]) - pesky_tam
            if odchod_z_domu > limit:
                break
            useky = ([{"typ": "pesky", "do": jizdy[0]["z"], "minut": pesky_tam}] if pesky_tam else []) + useky \
                + ([{"typ": "pesky", "z": self._zast(s_cil), "minut": odchod[s_cil]}] if odchod[s_cil] else [])
            spoj = {"odjezd": fmt(odchod_z_domu), "prijezd": fmt(prijezd), "minut": prijezd - odchod_z_domu,
                    "prestupy": len(jizdy) - 1, "useky": slouc_pesky(useky)}
            if out and out[-1]["prijezd"] == spoj["prijezd"]:
                out[-1] = spoj   # stejný příjezd, pozdější odjezd = méně čekání → nahradí předchozí
            else:
                out.append(spoj)
            t = odchod_z_domu + 1   # další spojení odjíždí nejdřív o minutu později
        return pesky + out

    def dostupnost_cilu(self, z: tuple[float, float], cile: pd.DataFrame, datum: date, od_min: int) -> pd.DataFrame:
        """Pro tabulku cílů (lat, lon) spočítá nejdřívější příjezd a dobu cesty jednou dopřednou CSA.
        Hledá do konce dne – o víkendu jede z vesnice první autobus klidně až po poledni."""
        d = self.den(datum.strftime("%Y%m%d"))
        pristup = self.zastavky_v_dosahu(*z)
        sources = {s: od_min + w for s, w in pristup.items()}
        arr, via = self.csa(d, sources, od_min, max(od_min + MAX_CESTA, KONEC_DNE))
        res = []
        for c in cile.itertuples():
            primo = float(haversine_m(z[0], z[1], c.lat, c.lon)) * OKLIKA
            best = (od_min + math.ceil(primo / CHUZE_M_ZA_MIN), None) if primo <= MAX_PESKY_M else (INF, None)
            for s, w in self.zastavky_v_dosahu(c.lat, c.lon).items():
                if arr[s] < INF and arr[s] + w < best[0]:
                    best = (arr[s] + w, s)
            if best[0] >= INF:
                res.append({"prijezd_min": None, "prestupy": None, "odjezd_min": None, "pesky": None, "zastavka": None,
                            "odjezd_spoje": None})
                continue
            if best[1] is None:   # pěšky
                res.append({"prijezd_min": best[0], "prestupy": 0, "odjezd_min": od_min, "pesky": True, "zastavka": None,
                            "odjezd_spoje": None})
                continue
            useky, s_start = self._useky(d, via, best[1])
            jizdy = [u for u in useky if u["typ"] != "pesky"]
            odj = hm(jizdy[0]["odjezd"]) - pristup[s_start] if jizdy else od_min
            res.append({"prijezd_min": best[0], "prestupy": max(len(jizdy) - 1, 0), "odjezd_min": odj, "pesky": not jizdy,
                        "zastavka": jizdy[0]["z"]["nazev"] if jizdy else None,
                        "odjezd_spoje": jizdy[0]["odjezd"] if jizdy else None})
        return pd.DataFrame(res, index=cile.index)
