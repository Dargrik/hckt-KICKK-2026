// Dojedeme – webová aplikace „Najít spoj“ (web/aplikace.html). Zrcadlí obrazovky iOS aplikace.
// Nahoře je jeden formulář přes celou šířku: vlevo Odkud (bydliště: našeptávač adres RÚIAN, moje poloha, mapa s pinem),
// vpravo Kam (Moje místa, Můj lékař, Nemocnice, Úřad, Pohotovost, Nový lékař) a pod ním Kdy (den a čas odjezdu),
// pod nimi tlačítko Najít spoj. Na telefonu a úzkém tabletu jde vše pod sebe. Výsledek je pod formulářem na téže stránce.
// Výsledek je v adrese stránky, takže funguje tlačítko Zpět i sdílení odkazu:
//   (bez hashe)                 jen formulář
//   #mista?typ=…[&nabira=1]     místa seřazená podle spojení (nemocnice, úřad, pohotovost, lékaři oboru)
//   #mista?q=…                  lékaři podle hledaného jména („Můj lékař“ bez výběru z nabídky)
//   #spojeni?cil=…              spoje tam a zpět k jednomu místu (+ &pobyt=…&smer=zpet)
//   všude volitelně &den=RRRR-MM-DD&cas=H:MM (bez nich: dnes, večer už zítra; odjezd teď, jiný den od 7:00)
// Staré odkazy #bydliste a #kam?q=… otevřou formulář. Při každé změně adresy se formulář srovná s ní (synchronizuj),
// změny ve formuláři se projeví až po Najít spoj. Na mobilu se formulář nad výsledkem sbalí do souhrnu „Upravit hledání“.
// U spoje tam jde poslat SMS seniorovi z účtu blízkého (GET /ucet, náhled GET /spojeni/sms, POST /ucet/poslat-spoj).
// Texty, formáty a přístupnost podle design/BRAND.md; API popisuje backend/API.md.
(function () {
  "use strict";
  const D = window.Dojedeme;
  const esc = D.esc;
  const K_BYDLISTE = "dojedeme.bydliste";
  const K_MISTA = "dojedeme.mista";
  const K_JMENA = "dojedeme.blizci.jmena";         // {"+420…": "Děda Josef"}: jména seniorů jen v tomto prohlížeči (pro-blizke.js)
  const K_ZRUSENY_REZIM = "dojedeme.jednoduchy";   // zrušený jednoduchý režim webu; starou hodnotu tiše mažeme
  const MAX_MIST = 6;
  const LIMIT = 15;
  const NAVRHU = 8;
  // našeptávač adres: server vrací adresy v pořadí dat (Hroznětínská v Otovicích před Hroznětínem), proto si
  // vezmeme víc adres (asi 18 kB) a seřadíme je sami: shoda s obcí, pak s ulicí; ukážeme prvních NAVRHU_ADRES
  const ADRES_DOTAZ = 200;
  const NAVRHU_ADRES = 8;
  const LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/";   // stejná verze jako na /mapa

  // hledání „Můj lékař“: jen lékaři (nemocnice, úřad a pohotovost mají vlastní volbu)
  const TYPY_LEKARU = "praktik,zubar,gynekolog,pediatr,ocni,psychiatr,endokrinolog,rehabilitace,dentalni_hygiena";
  // místa, která jsou pro všechny stejná → seznam seřazený podle spojení z bydliště
  const SPOLECNE = {
    nemocnice: { nazev: "Nemocnice", typ: "nemocnice",
      popis: "Ukážeme nemocnice. Nahoře budou ty, kam se spojem dostanete nejdřív." },
    urad: { nazev: "Úřad", typ: "obecni_urad,urad_orp", urady: "moje",
      popis: "Úřad vaší obce a úřad, kde vyřídíte občanský průkaz, pas nebo řidičský průkaz.",
      lead: "Úřady, pod které vaše obec patří. Občanský průkaz, pas nebo řidičský průkaz vyřídíte na úřadu obce s rozšířenou působností." },
    pohotovost: { nazev: "Pohotovost", typ: "pohotovost,zubni_pohotovost,pohotovost_chirurgie",
      popis: "Lékařská a zubní pohotovost. Ve všední dny mají většinou otevřeno až odpoledne.",
      lead: "Lékařská a zubní pohotovost. Ve všední dny mají většinou otevřeno až odpoledne. Otevírací dobu najdete u každého místa." },
  };
  // volby v poli Kam (pořadí = pořadí na obrazovce)
  const KAM = [
    { k: "lekar", nazev: "Můj lékař", ikona: "stethoscope" },
    { k: "nemocnice", nazev: "Nemocnice", ikona: "hospital" },
    { k: "urad", nazev: "Úřad", ikona: "bank" },
    { k: "pohotovost", nazev: "Pohotovost", ikona: "first-aid" },
    { k: "novy", nazev: "Nový lékař", ikona: "user-plus" },
  ];
  // obory pro „Nový lékař“ (typ pro /cile = klíč)
  const OBORY = {
    praktik: { nazev: "Praktický lékař", novy: "Nový praktický lékař", vsichni: "Praktičtí lékaři v dosahu", odkaz: "všechny praktické lékaře" },
    zubar: { nazev: "Zubař", novy: "Nový zubař", vsichni: "Zubaři v dosahu", odkaz: "všechny zubaře" },
    gynekolog: { nazev: "Gynekolog", novy: "Nový gynekolog", vsichni: "Gynekologové v dosahu", odkaz: "všechny gynekology" },
    ocni: { nazev: "Oční lékař", novy: "Nový oční lékař", vsichni: "Oční lékaři v dosahu", odkaz: "všechny oční lékaře" },
    pediatr: { nazev: "Dětský lékař", novy: "Nový dětský lékař", vsichni: "Dětští lékaři v dosahu", odkaz: "všechny dětské lékaře" },
    psychiatr: { nazev: "Psychiatr", novy: "Nový psychiatr", vsichni: "Psychiatři v dosahu", odkaz: "všechny psychiatry" },
    endokrinolog: { nazev: "Endokrinolog", novy: "Nový endokrinolog", vsichni: "Endokrinologové v dosahu", odkaz: "všechny endokrinology" },
    rehabilitace: { nazev: "Rehabilitace", novy: "Rehabilitace pro nové pacienty", vsichni: "Rehabilitace v dosahu", odkaz: "všechna rehabilitační pracoviště" },
  };
  const POPIS_TYPU = { urad_orp: "Úřad obce s rozšířenou působností" };
  const POBYT = [30, 45, 60, 90, 120, 180];
  const DRUHY = { bus: ["Autobus", "bus"], vlak: ["Vlak", "train"], tramvaj: ["Tramvaj", "tram"], trolejbus: ["Trolejbus", "bus"] };
  const CHYBY = ["odkud-chyba", "kam-chyba", "lekar-chyba", "obor-chyba"];
  const VSTUP_CHYBY = { "odkud-chyba": "adresa", "lekar-chyba": "lekar-hledat" };

  const stav = {
    bydliste: D.uloziste.cti(K_BYDLISTE),
    upravujiOdkud: false,     // pole Odkud je otevřené pro novou adresu
    upravuji: false,          // mobil: formulář nad výsledkem je rozbalený
    maVysledky: false,        // pod formulářem je výsledek (seznam míst nebo spoje)
    hashFormulare: null,      // adresa, které odpovídá vyplněný formulář (upozornění na neodeslané změny)
    posledniHash: "",
    posledniMista: null,      // adresa posledního seznamu míst (odkaz „Zpět na seznam míst“)
    nazevVysledku: "",        // název místa ve výsledku Spoje (souhrn na mobilu)
    cileCache: {},            // id cíle → cíl z /cile (nadpis spojení hned, bez čekání)
    seniorExpres: {},         // "lat,lon" → Promise se službami Senior Expres v obci bydliště
    seKolo: 0,
    zdroj: null,              // platnost jízdních řádů z /zdravi
    nacitani: 0,              // pořadí vykreslení (starší odpovědi se zahodí)
    fokusPoNacteni: null,     // kam přesunout fokus, až se načtou spoje
    mys: false,               // poslední volba v poli Kam byla myší / prstem (ne šipkami)
    prvni: true,
  };
  // vyplněný formulář: kam = lekar | nemocnice | urad | pohotovost | novy | misto (jedno konkrétní místo, např. z Mých míst)
  const f = { kam: null, misto: null, lekar: null, q: "", obor: null, den: null, cas: null };

  const el = (id) => document.getElementById(id);
  const formular = el("hledani");
  const vysledek = el("vysledek");
  const oddilVysledky = el("oddil-vysledky");

  // --- pomocné funkce ----------------------------------------------------------------
  function ikona(nazev, trida = "") { return `<i class="ph-bold ph-${nazev}${trida ? " " + trida : ""}" aria-hidden="true"></i>`; }
  function velke(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }
  /** „Abertamy,nám.“ → „Abertamy, nám.“ (názvy zastávek z CIS JŘ) */
  function zastavka(n) { return String(n || "").replace(/,(?=\S)/g, ", "); }
  /** konec věty bez zdvojené tečky („Hroznětín, nám.“ + „.“) */
  function veta(s) { s = String(s || ""); return /\.$/.test(s) ? s : s + "."; }
  /** „7:00-15:30“ → „7:00–15:30“ (rozsahy čísel s pomlčkou) */
  function rozsahy(s) { return String(s || "").replace(/(\d)\s*-\s*(\d)/g, "$1–$2"); }
  function minutDne(t) { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; }
  function casZMinut(m) { m = ((m % 1440) + 1440) % 1440; return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`; }
  /** „v 7:40“, „ve 14:35“ (ve 2, 3, 4, 12, 13, 14, 20–23) */
  function vCas(t) { const h = parseInt(t, 10); return ([2, 3, 4, 12, 13, 14, 20, 21, 22, 23].includes(h) ? "ve " : "v ") + t; }
  function pocetMist(n) { return n === 1 ? "1 místo" : n >= 2 && n <= 4 ? `${n} místa` : `${n} míst`; }
  function pocetAdres(n) { return n === 1 ? "1 adresa" : n >= 2 && n <= 4 ? `${n} adresy` : `${n} adres`; }
  function pocetZnaku(n) { return n === 1 ? "1 znak" : n >= 2 && n <= 4 ? `${n} znaky` : `${n} znaků`; }
  function hlas(text) { const h = el("hlaseni"); h.textContent = ""; setTimeout(() => { h.textContent = text; }, 80); }
  function platnyCas(t) { return /^\d{1,2}:\d{2}$/.test(t || "") && minutDne(t) < 1440 ? t : null; }
  function bezpecnyOdkaz(url) { return /^https?:\/\//i.test(url || "") ? url : null; }
  function typCile(c) { return POPIS_TYPU[c.typ] || c.typ_nazev || ""; }
  /** „Karlovarská 232, Hroznětín“ → „Karlovarská 232“ (obec je v popisu zvlášť) */
  function ulice(adresa) { return String(adresa || "").split(",")[0].trim(); }
  function bezDiakritiky(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  /** Adresa na dva řádky: „Karlovarská 232, Hroznětín“ → {hlavni: „Karlovarská 232“, obec: „Hroznětín“};
   *  „Abertamy 201“ (obec bez ulic) → {hlavni: „Abertamy 201“, obec: „Abertamy“}; „Moje poloha (Nejdek)“ → {hlavni: „Moje poloha“, obec: „Nejdek“}. */
  function rozdelAdresu(a) {
    const s = String(a || "").trim();
    const p = s.match(/^Moje poloha(?: \((.+)\))?$/);
    if (p) return { hlavni: "Moje poloha", obec: p[1] || "" };
    const i = s.lastIndexOf(", ");
    if (i > 0) return { hlavni: s.slice(0, i), obec: s.slice(i + 2) };
    const m = s.match(/^(.+?)\s+(?:č\. ev\. )?\d[\d/]*[a-zA-Z]?$/);
    return { hlavni: s, obec: m ? m[1] : "" };
  }
  /** Adresy ze serveru seřazené podle shody slov dotazu: nejdřív obec („hroznetin“ → Hroznětín), pak ulice nebo část obce.
   *  Při stejné shodě zůstává pořadí serveru. */
  function seradAdresy(adresy, q) {
    const slova = bezDiakritiky(q).split(/[\s,]+/).filter((t) => t && !/^\d/.test(t));
    if (!slova.length) return adresy;
    const skore = (a) => {
      const r = rozdelAdresu(a.adresa);
      const obec = bezDiakritiky(r.obec), obecSlova = obec.split(/[\s-]+/), uliceSlova = bezDiakritiky(r.hlavni).split(/[\s-]+/);
      return slova.reduce((s, t) => s
        + (obec === t || obecSlova.includes(t) ? 6 : obecSlova.some((w) => w.startsWith(t)) ? 4 : 0)
        + (uliceSlova.some((w) => w.startsWith(t)) ? 2 : 0), 0);
    };
    return adresy.map((a, i) => [skore(a), i, a]).sort((x, y) => y[0] - x[0] || x[1] - y[1]).map((x) => x[2]);
  }

  function dnes() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function posun(d, dni) { const x = new Date(d); x.setDate(x.getDate() + dni); return x; }
  function denZ(iso) {
    const t = dnes();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return t;
    const [r, m, d] = iso.split("-").map(Number);
    const x = new Date(r, m - 1, d);
    return isNaN(x) || x < t ? t : x;
  }
  /** bez zvoleného dne: dnes, večer (od 19:00) už zítra */
  function vychoziDen(iso) { return iso ? denZ(iso) : new Date().getHours() >= 19 ? posun(dnes(), 1) : dnes(); }
  function jeDnes(d) { return D.isoDatum(d) === D.isoDatum(dnes()); }
  // Dojedeme.denSlovy skloňuje špatně („ve úterý“, „v neděle“) – vlastní verze se správnými tvary
  const DNY_1 = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
  const DNY_4 = ["v neděli", "v pondělí", "v úterý", "ve středu", "ve čtvrtek", "v pátek", "v sobotu"];
  function rozdilDni(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return Math.round((x - dnes()) / 864e5); }
  /** Date → „dnes“ / „zítra“ / „v pondělí 12. 10.“ (do věty) */
  function denSlovy(d) { const r = rozdilDni(d); return r === 0 ? "dnes" : r === 1 ? "zítra" : `${DNY_4[d.getDay()]} ${d.getDate()}. ${d.getMonth() + 1}.`; }
  /** text na tlačítko dne: „Dnes“, „Zítra“, „Pondělí 12. 10.“ */
  function popisDne(d) { const r = rozdilDni(d); return r === 0 ? "Dnes" : r === 1 ? "Zítra" : `${velke(DNY_1[d.getDay()])} ${d.getDate()}. ${d.getMonth() + 1}.`; }
  /** nejbližší další pracovní den (přes víkend jezdí málo spojů) */
  function dalsiPracovniDen(d) { let x = posun(d, 1); while (x.getDay() === 0 || x.getDay() === 6) x = posun(x, 1); return x; }
  /** daný den, nebo nejbližší pracovní den po něm (řazení nabídky lékařů, aby o víkendu nebylo všechno „bez spoje“) */
  function pracovniDenOd(d) { return d.getDay() === 0 || d.getDay() === 6 ? dalsiPracovniDen(d) : d; }
  /** výchozí čas odjezdu: dnes teď (nejdřív 7:00), jiný den 7:00 */
  function vychoziCas(den) {
    if (!jeDnes(den)) return "7:00";
    const ted = new Date();
    return ted.getHours() * 60 + ted.getMinutes() > 7 * 60 ? D.cas(ted) : "7:00";
  }
  f.den = vychoziDen();

  // --- adresa stránky (hash) -------------------------------------------------------------
  function ctiHash() {
    const h = location.hash.slice(1);
    const i = h.indexOf("?");
    return { krok: i < 0 ? h : h.slice(0, i), p: new URLSearchParams(i < 0 ? "" : h.slice(i + 1)) };
  }
  function hashZ(krok, parametry = {}) {
    const q = new URLSearchParams(Object.entries(parametry).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString();
    return "#" + krok + (q ? "?" + q : "");
  }
  /** Adresa bez hashe (jen formulář). */
  function bezHashe() { history.replaceState(null, "", location.pathname + location.search); }
  /** Změní parametry výsledku bez nového záznamu v historii (den, čas, pobyt) a vrátí fokus na ovládací prvek. */
  function zmen(zmeny, fokus) {
    const { krok, p } = ctiHash();
    const o = Object.fromEntries(p.entries());
    Object.entries(zmeny).forEach(([k, v]) => { if (v === null || v === undefined || v === "") delete o[k]; else o[k] = String(v); });
    history.replaceState(null, "", hashZ(krok, o));
    vykresli({ fokus });
  }

  // --- Moje místa (jen v tomto prohlížeči) ------------------------------------------------
  function mojeMista() {
    const m = D.uloziste.cti(K_MISTA, []);
    return (Array.isArray(m) ? m : [])
      .filter((x) => x && typeof x === "object" && typeof x.id === "string" && x.id && typeof x.nazev === "string" && x.nazev)
      .slice(0, MAX_MIST);
  }
  function ulozeneMisto(id) { return mojeMista().find((x) => x.id === id) || null; }
  /** Uloží místo; pořadí zůstává (kdo má nahoře svého praktika, má ho tam pořád). Když je plno, vypadne nejdéle nepoužité. */
  function pridejMisto(c) {
    const m = mojeMista();
    const zaznam = { id: String(c.id), nazev: String(c.nazev).trim(), obec: c.obec || "", adresa: c.adresa || "",
                     typ: c.typ || "", typ_nazev: c.typ_nazev || "", pouzito: Date.now() };
    const i = m.findIndex((x) => x.id === zaznam.id);
    if (i >= 0) m[i] = zaznam;
    else {
      if (m.length >= MAX_MIST) {
        let j = 0;
        m.forEach((x, k) => { if ((x.pouzito || 0) < (m[j].pouzito || 0)) j = k; });
        m.splice(j, 1);
      }
      m.push(zaznam);
    }
    D.uloziste.zapis(K_MISTA, m);
  }
  function pouzijMisto(id) {
    const m = mojeMista();
    const x = m.find((y) => y.id === id);
    if (x) { x.pouzito = Date.now(); D.uloziste.zapis(K_MISTA, m); }
  }
  function odeberMisto(id) { D.uloziste.zapis(K_MISTA, mojeMista().filter((x) => x.id !== id)); }
  /** „MUDr. Jan Jedelský, Hroznětín“ */
  function jmenoMista(x) {
    const nazev = String(x.nazev || "").trim();
    const obec = x.obec && !nazev.includes(x.obec) ? x.obec : "";
    return obec ? `${nazev}, ${obec}` : nazev;
  }

  // --- cíle z API ----------------------------------------------------------------------------
  /** GET /cile seřazené podle spojení → {cile, celkem}. Když filtru (nabira, q) nic neodpovídá, server s polohou
   *  vrací chybu, proto se nejdřív bez polohy (rychle) zeptáme na počet; s polohou se ptáme, jen když něco je. */
  async function cileSeSpojenim(parametry) {
    let celkem = null;
    if (parametry.nabira || parametry.q) {
      const { lat, lon, datum, cas, ...bezPolohy } = parametry;
      celkem = (await D.api("/cile", { parametry: { ...bezPolohy, limit: 1 } })).pocet || 0;
      if (!celkem) return { cile: [], celkem: 0 };
    }
    const d = await D.api("/cile", { parametry });
    const videne = new Set();   // první výskyt id vyhrává (stejně jako na serveru)
    const cile = (d.cile || []).filter((c) => c && c.id && !videne.has(c.id) && videne.add(c.id));
    return { cile, celkem: celkem === null ? cile.length : celkem };
  }

  // --- formulář: stav a souhrn ------------------------------------------------------------------
  function casFormulare() { return f.cas || vychoziCas(f.den); }
  /** Adresa výsledku, kterou formulář právě popisuje (null = formulář není vyplněný). */
  function cilovyHash() {
    const iso = D.isoDatum(f.den);
    const par = { den: iso === D.isoDatum(vychoziDen()) ? null : iso, cas: f.cas };
    if (f.kam === "misto" && f.misto) return hashZ("spojeni", { cil: f.misto.id, ...par, pobyt: pobytZAdresy(f.misto.id) });
    if (f.kam === "lekar" && f.lekar) return hashZ("spojeni", { cil: f.lekar.id, ...par, pobyt: pobytZAdresy(f.lekar.id) });
    if (f.kam === "lekar" && f.q.trim()) return hashZ("mista", { q: f.q.trim(), ...par });
    if (SPOLECNE[f.kam]) return hashZ("mista", { typ: f.kam, ...par });
    if (f.kam === "novy" && f.obor) return hashZ("mista", { typ: f.obor, nabira: 1, ...par });
    return null;
  }
  /** Zvolená délka pobytu zůstane, když se znovu hledá spoj ke stejnému místu. */
  function pobytZAdresy(id) {
    const { krok, p } = ctiHash();
    return krok === "spojeni" && p.get("cil") === id && POBYT.includes(+p.get("pobyt")) ? p.get("pobyt") : null;
  }
  function popisKam() {
    if (f.kam === "misto") return f.misto && f.misto.nazev ? jmenoMista(f.misto) : "vybrané místo";
    if (f.kam === "lekar") return f.lekar ? jmenoMista(f.lekar) : f.q.trim() ? `lékař „${f.q.trim()}“` : "Můj lékař";
    if (SPOLECNE[f.kam]) return SPOLECNE[f.kam].nazev;
    if (f.kam === "novy") return f.obor ? OBORY[f.obor].novy : "Nový lékař";
    return "";
  }

  /** Souhrn hledání nad výsledkem (jen na mobilu, kde je formulář sbalený). */
  function vykresliSouhrn() {
    const kam = ctiHash().krok === "spojeni" && stav.nazevVysledku ? stav.nazevVysledku : popisKam();
    el("hledani-souhrn").innerHTML = `
      <dl class="souhrn-udaje">
        <div><dt>Odkud</dt><dd>${esc(stav.bydliste ? stav.bydliste.adresa : "nevyplněno")}</dd></div>
        <div><dt>Kam</dt><dd>${esc(velke(kam || "nevyplněno"))}</dd></div>
        <div><dt>Kdy</dt><dd>${esc(velke(denSlovy(f.den)))} od ${esc(casFormulare())}</dd></div>
      </dl>
      <button type="button" class="tlacitko vedlejsi" id="upravit-hledani">${ikona("pencil-simple")}Upravit hledání</button>`;
  }
  /** Po každé změně formuláře: souhrn a upozornění, že výsledek níže je ještě pro původní zadání. */
  function zmena() {
    el("hledat-pozn").hidden = !(stav.maVysledky && cilovyHash() !== stav.hashFormulare);
    vykresliSouhrn();
  }

  // --- formulář: chyby --------------------------------------------------------------------------
  function nastavChybu(id, text) {
    const p = el(id);
    if (p) p.textContent = text || "";
    const vstup = el(VSTUP_CHYBY[id]);
    if (vstup) { if (text) vstup.setAttribute("aria-invalid", "true"); else vstup.removeAttribute("aria-invalid"); }
    if (!text && CHYBY.every((x) => !el(x) || !el(x).textContent)) el("chyby-souhrn").hidden = true;
  }
  /** [id chyby u pole, id prvku pro fokus, text do souhrnu, krátký text u pole] */
  function zkontroluj() {
    const chyby = [];
    const adresa = el("adresa");
    if (!stav.bydliste) {
      chyby.push(["odkud-chyba", "adresa", "Odkud pojedete: napište adresu a vyberte ji ze seznamu.", "Napište adresu a vyberte ji ze seznamu."]);
    } else if (stav.upravujiOdkud && adresa && adresa.value.trim()) {
      chyby.push(["odkud-chyba", "adresa", "Odkud pojedete: vyberte novou adresu ze seznamu, nebo ponechte původní.", "Vyberte adresu ze seznamu, nebo stiskněte Ponechat."]);
    }
    if (!f.kam || (f.kam === "misto" && !f.misto)) {
      chyby.push(["kam-chyba", "kam-r-lekar", "Kam potřebujete: vyberte jednu možnost.", "Vyberte jednu možnost."]);
    } else if (f.kam === "lekar" && !f.lekar && f.q.replace(/\s/g, "").length < 2) {
      chyby.push(["lekar-chyba", "lekar-hledat", "Kam potřebujete: napište jméno lékaře, název ordinace nebo obec.", "Napište aspoň 2 písmena jména, ordinace nebo obce."]);
    } else if (f.kam === "novy" && !f.obor) {
      chyby.push(["obor-chyba", "obor-praktik", "Kam potřebujete: vyberte, jakého lékaře hledáte.", "Vyberte jednu možnost."]);
    }
    return chyby;
  }

  /** Najít spoj: kontrola, pak výsledek do adresy stránky (vykreslí ho hashchange). */
  function odesli(e) {
    if (e) e.preventDefault();
    const adresa = el("adresa");
    if (stav.upravujiOdkud && stav.bydliste && adresa && !adresa.value.trim()) { stav.upravujiOdkud = false; vykresliOdkud(); }
    const chyby = zkontroluj();
    CHYBY.forEach((id) => nastavChybu(id, ""));
    const souhrn = el("chyby-souhrn");
    if (chyby.length) {
      chyby.forEach(([id, , , kratce]) => nastavChybu(id, kratce));
      souhrn.innerHTML = `${ikona("warning", "ikona")}<div><strong>Než budeme hledat, doplňte prosím:</strong>
        <ul>${chyby.map(([, pole, text]) => `<li><button type="button" class="odkaz-tlacitko" data-pole="${pole}">${esc(text)}</button></li>`).join("")}</ul></div>`;
      souhrn.hidden = false;
      stav.upravuji = true;
      formular.classList.remove("sbaleno");
      souhrn.focus();
      return;
    }
    souhrn.hidden = true;
    const h = cilovyHash();
    if (f.kam === "lekar" && f.lekar) pridejMisto(f.lekar);   // svého lékaře najde příště mezi Mými místy
    if (f.kam === "misto" && f.misto) pouzijMisto(f.misto.id);
    if (f.kam === "lekar" || f.kam === "misto") stav.posledniMista = null;
    stav.upravuji = false;
    if (location.hash === h) vykresli(); else location.hash = h;
  }

  // --- formulář: kostra a události ---------------------------------------------------------------
  function pripravFormular() {
    el("kam-volby").innerHTML = KAM.map((v) => `
      <label class="kam-volba" for="kam-r-${v.k}">
        <input type="radio" name="kam" id="kam-r-${v.k}" value="${v.k}">
        ${ikona(v.ikona, "kv-ikona")}
        <span class="kv-text">${esc(v.nazev)}</span>
        <span class="kv-znak" aria-hidden="true">${ikona("check")}</span>
      </label>`).join("");

    el("kam-lekar").innerHTML = `
      <div class="naseptavac" id="nas-lekar">
        <label for="lekar-hledat">Jméno lékaře, název ordinace nebo obec</label>
        <p class="napoveda-pole" id="lekar-napoveda">Například Jedelský nebo Nejdek. Diakritiku psát nemusíte. Pak lékaře vyberte ze seznamu.</p>
        <input type="text" id="lekar-hledat" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="lekar-seznam"
               aria-describedby="lekar-napoveda lekar-stav lekar-chyba" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="80" enterkeyhint="search">
        <p class="naseptavac-stav" id="lekar-stav" aria-live="polite"></p>
        <ul id="lekar-seznam" role="listbox" aria-label="Nalezení lékaři" hidden></ul>
        <p class="pole-chyba" id="lekar-chyba"></p>
      </div>`;

    el("kam-novy").innerHTML = `
      <fieldset class="obory-pole" aria-describedby="obor-napoveda obor-chyba">
        <legend>Jakého lékaře hledáte</legend>
        <p class="napoveda-pole" id="obor-napoveda">Ukážeme lékaře v dosahu, kteří podle seznamu kraje přijímají nové pacienty.</p>
        <p class="pole-chyba" id="obor-chyba"></p>
        <div class="obory">${Object.entries(OBORY).map(([k, o]) => `
          <label class="obor-volba" for="obor-${k}"><input type="radio" name="obor" id="obor-${k}" value="${k}">${ikona("check", "obor-znak")}<span>${esc(o.nazev)}</span></label>`).join("")}
        </div>
      </fieldset>`;

    formular.addEventListener("submit", odesli);
    // pole Kam: myší nebo prstem rovnou do pole se jménem lékaře; šipkami se jen přepíná volba
    el("kam-volby").addEventListener("pointerdown", () => { stav.mys = true; });
    el("kam-volby").addEventListener("keydown", () => { stav.mys = false; });
    el("kam-volby").addEventListener("change", (e) => {
      if (e.target.name !== "kam") return;
      f.kam = e.target.value;
      f.misto = null;
      nastavChybu("kam-chyba", "");
      nastavKam();
      zmena();
      if (stav.mys && f.kam === "lekar") el("lekar-hledat").focus();
      stav.mys = false;
    });
    el("kam-novy").addEventListener("change", (e) => {
      if (e.target.name !== "obor") return;
      f.obor = e.target.value;
      nastavChybu("obor-chyba", "");
      nastavKam();
      zmena();
    });
    napojLekare();
    napojMojeMista();
    napojKdy();

    el("chyby-souhrn").addEventListener("click", (e) => {
      const b = e.target.closest("[data-pole]");
      if (!b) return;
      const cil = el(b.dataset.pole);
      if (cil) { cil.scrollIntoView({ block: "center" }); cil.focus({ preventScroll: true }); }
    });
    el("hledani-souhrn").addEventListener("click", (e) => {
      if (!e.target.closest("#upravit-hledani")) return;
      stav.upravuji = true;
      formular.classList.remove("sbaleno");
      const n = el("hledani-nadpis");
      n.scrollIntoView({ block: "start" });
      n.focus({ preventScroll: true });
    });
    formular.hidden = false;
  }

  /** Stav pole Kam podle f (zaškrtnutá volba, pole se jménem lékaře, obory, Moje místa). */
  function nastavKam() {
    formular.querySelectorAll('input[name="kam"]').forEach((r) => {
      r.checked = r.value === f.kam;
      r.closest(".kam-volba").classList.toggle("vybrano", r.checked);
    });
    el("kam-lekar").hidden = f.kam !== "lekar";
    el("kam-novy").hidden = f.kam !== "novy";
    const vstup = el("lekar-hledat");
    if (document.activeElement !== vstup) vstup.value = f.lekar ? f.lekar.nazev : f.q;
    formular.querySelectorAll('input[name="obor"]').forEach((r) => {
      r.checked = r.value === f.obor;
      r.closest(".obor-volba").classList.toggle("vybrano", r.checked);
    });
    const popis = el("kam-popis");
    popis.textContent = SPOLECNE[f.kam] ? SPOLECNE[f.kam].popis : "";
    popis.hidden = !popis.textContent;
    vykresliMojeMista();
  }

  // --- 1 Odkud ------------------------------------------------------------------------------------
  function vykresliOdkud(fokus) {
    const b = stav.bydliste, obal = el("odkud-obsah");
    if (b && !stav.upravujiOdkud) {
      const r = rozdelAdresu(b.adresa);
      const poloha = b.zdroj === "poloha";
      const popis = poloha ? [r.obec, "podle polohy zařízení"].filter(Boolean).join(", ") : r.obec !== r.hlavni ? r.obec : "";
      obal.innerHTML = `
        <div class="odkud-vyplneno">
          ${ikona(poloha ? "navigation-arrow" : "map-pin", "ov-ikona")}
          <span class="ov-text"><span class="sr">Bydliště: </span><span class="ov-adresa">${esc(r.hlavni)}</span>${popis ? `<span class="ov-popis">${esc(velke(popis))}</span>` : ""}</span>
          <button type="button" class="odkaz-tlacitko ov-zmenit" id="odkud-zmenit">Změnit<span class="sr"> odkud pojedete</span></button>
        </div>`;
      el("odkud-zmenit").addEventListener("click", () => { stav.upravujiOdkud = true; vykresliOdkud("#adresa"); });
    } else {
      obal.innerHTML = `
        <div class="naseptavac naseptavac-adresa" id="nas-adresa">
          <label for="adresa">Adresa bydliště</label>
          <p class="napoveda-pole" id="adresa-napoveda">Obec, nebo ulice a číslo domu, například Abertamy 115. Diakritiku psát nemusíte. Pak adresu vyberte ze seznamu.</p>
          <div class="adresa-pole">
            ${ikona("magnifying-glass", "adresa-lupa")}
            <input id="adresa" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="adresa-seznam"
                   aria-describedby="adresa-napoveda adresa-stav odkud-chyba" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="80" enterkeyhint="search">
          </div>
          <p class="naseptavac-stav" id="adresa-stav" aria-live="polite"></p>
          <ul id="adresa-seznam" role="listbox" aria-label="Nalezené adresy" hidden></ul>
        </div>
        <div class="odkud-akce">
          <button type="button" class="tlacitko vedlejsi" id="poloha">${ikona("navigation-arrow")}Použít moji polohu</button>
          ${b ? `<button type="button" class="odkaz-tlacitko" id="odkud-ponechat">Ponechat ${esc(b.adresa)}</button>` : ""}
        </div>
        <div id="poloha-stav" aria-live="polite"></div>`;
      naseptavac(el("nas-adresa"), {
        minZnaku: 3,
        enterBezVyberu: false,
        kratke: "Napište aspoň 3 znaky.",
        html: (a) => {
          const r = rozdelAdresu(a.adresa);
          return `<span class="nv-nazev">${esc(r.hlavni)}</span>${r.obec && r.obec !== r.hlavni ? `<span class="nv-popis">${esc(r.obec)}</span>` : ""}`;
        },
        text: (a) => a.adresa,
        hledej: hledejAdresy,
        priVyberu: (a) => {
          if (!a) return;
          ulozBydliste({ adresa: a.adresa, lat: a.lat, lon: a.lon, kod_obce: a.kod_obce, zdroj: "adresa" });
        },
      });
      el("poloha").addEventListener("click", pouzijPolohu);
      if (b) el("odkud-ponechat").addEventListener("click", () => {
        stav.upravujiOdkud = false;
        nastavChybu("odkud-chyba", "");
        vykresliOdkud("#odkud-zmenit");
      });
    }
    vykresliMapu();
    if (fokus) { const x = document.querySelector(fokus); if (x) x.focus(); }
  }

  /** Našeptávač adres: GET /adresy (bez diakritiky, číslo domu musí sedět přesně), seřazené podle shody s obcí.
   *  Když s číslem domu nic není, zkusí totéž bez čísla a nabídne adresy ulice. */
  async function hledejAdresy(q) {
    const dotaz = async (text) => {
      const d = await D.api("/adresy", { parametry: { q: text, limit: ADRES_DOTAZ } });
      const vse = d.adresy || [];
      return { polozky: seradAdresy(vse, text).slice(0, NAVRHU_ADRES), pocet: d.pocet || vse.length };
    };
    const { polozky, pocet } = await dotaz(q);
    if (polozky.length) {
      return { polozky, zprava: pocet > polozky.length
        ? `Našli jsme ${pocetAdres(pocet)}, ukazujeme ${polozky.length}. Doplňte ulici a číslo domu, nebo vyberte šipkami či klepnutím.`
        : `${velke(pocetAdres(polozky.length))} v nabídce. Vyberte šipkami nebo klepnutím.` };
    }
    const slova = q.split(/[\s,]+/).filter(Boolean);
    const cisla = slova.filter((t) => /^\d/.test(t));
    const bezCisla = slova.filter((t) => !/^\d/.test(t)).join(" ");
    if (cisla.length && bezCisla.replace(/\s/g, "").length >= 3) {
      const r = await dotaz(bezCisla);
      if (r.polozky.length) {
        return { polozky: r.polozky, nic: true,
          zprava: `Číslo domu ${cisla.join(" ")} jsme u této adresy nenašli. Vyberte adresu ze seznamu, nebo číslo opravte.` };
      }
    }
    return { polozky: [], nic: true,
      zprava: "Takovou adresu nenacházíme. Zkuste napsat jen název obce, například Hroznětín, a adresu pak vyberte ze seznamu." };
  }

  // --- mapa s bydlištěm (Leaflet z cdnjs jako na /mapa, šedý podklad OpenStreetMap) ---------------
  let leafletSlib = null;
  /** Leaflet se načte až ve chvíli, kdy je co ukázat (stránka bez něj funguje celá). */
  function nactiLeaflet() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (leafletSlib) return leafletSlib;
    leafletSlib = new Promise((hotovo, chyba) => {
      const css = document.createElement("link");
      css.rel = "stylesheet"; css.href = LEAFLET + "leaflet.min.css"; css.crossOrigin = "anonymous";
      // před aplikace.css (jako na /mapa), aby naše úpravy mapy (ovládání 48 px, písmo) měly přednost
      document.head.insertBefore(css, document.querySelector('link[href*="/aplikace.css"]'));
      const s = document.createElement("script");
      s.src = LEAFLET + "leaflet.min.js"; s.crossOrigin = "anonymous"; s.async = true;
      s.onload = () => (window.L && window.L.map ? hotovo(window.L) : chyba(new Error("Mapa se nenačetla.")));
      s.onerror = () => { leafletSlib = null; s.remove(); chyba(new Error("Mapa se nenačetla.")); };
      document.head.appendChild(s);
    });
    return leafletSlib;
  }
  const mapa = { m: null, pin: null, bod: null, kolo: 0 };
  /** Pod polem Odkud: mapa s pinem na bydlišti; dokud adresa není vybraná, jen prázdné místo s popisem (na širokém displeji). */
  function vykresliMapu() {
    const b = stav.bydliste, ukazat = !!b && !stav.upravujiOdkud && isFinite(b.lat) && isFinite(b.lon);
    const ram = el("odkud-mapa"), prazdna = el("odkud-mapa-prazdna");
    const kolo = ++mapa.kolo;
    prazdna.hidden = ukazat;
    ram.hidden = !ukazat;
    if (!ukazat) return;
    const plocha = el("odkud-mapa-plocha");
    const r = rozdelAdresu(b.adresa);
    plocha.setAttribute("aria-label", `Mapa: ${[r.hlavni, r.obec !== r.hlavni ? r.obec : ""].filter(Boolean).join(", ")}`);
    nactiLeaflet().then((L) => {
      if (kolo !== mapa.kolo) return;
      mapa.bod = [+b.lat, +b.lon];
      const zoom = b.zdroj === "poloha" ? 14 : 16;
      if (!mapa.m) {
        mapa.m = L.map(plocha, {
          zoomControl: false, scrollWheelZoom: false, dragging: !L.Browser.mobile, minZoom: 9, maxZoom: 18,
          attributionControl: true, fadeAnimation: !klid(), zoomAnimation: !klid(), markerZoomAnimation: !klid(),
        });
        mapa.m.attributionControl.setPrefix(false);
        L.control.zoom({ zoomInTitle: "Přiblížit", zoomOutTitle: "Oddálit" }).addTo(mapa.m);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(mapa.m);
        plocha.setAttribute("role", "group");
        // velikost se mění se šířkou okna a se sbalením formuláře na mobilu → přepočítat a pin zase doprostřed
        if (window.ResizeObserver) new ResizeObserver(() => {
          if (!mapa.m || !plocha.offsetWidth) return;
          mapa.m.invalidateSize({ pan: false });
          if (mapa.bod) mapa.m.setView(mapa.bod, mapa.m.getZoom(), { animate: false });
        }).observe(plocha);
      }
      mapa.m.setView(mapa.bod, zoom, { animate: false });
      const pin = L.divIcon({ className: "pin-bydliste", html: `<span class="pin-telo">${ikona(b.zdroj === "poloha" ? "navigation-arrow" : "house")}</span>`,
        iconSize: [44, 52], iconAnchor: [22, 50] });
      if (!mapa.pin) mapa.pin = L.marker(mapa.bod, { icon: pin, keyboard: false, interactive: false }).addTo(mapa.m);
      else mapa.pin.setLatLng(mapa.bod).setIcon(pin);
    }).catch(() => {
      if (kolo !== mapa.kolo) return;
      ram.hidden = true;   // bez mapy to jde i tak: adresa je napsaná nahoře
    });
  }
  function klid() { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }

  function ulozBydliste(b) {
    stav.bydliste = b;
    D.uloziste.zapis(K_BYDLISTE, b);
    seniorExpresBydliste(b);   // ať je karta Senior Expres hned
    stav.upravujiOdkud = false;
    nastavChybu("odkud-chyba", "");
    hlas(`Bydliště je uložené: ${b.adresa}.`);
    if (stav.maVysledky) {      // výsledek je z bydliště → hned ho přepočítat (a ukázat, když dosud chybělo bydliště)
      vykresliOdkud();
      vykresli();
      return;
    }
    vykresliOdkud();
    vykresliSe();
    zmena();
    const dalsi = formular.querySelector('input[name="kam"]:checked') || el("kam-r-lekar");
    dalsi.focus();
  }

  function pouzijPolohu() {
    const tl = el("poloha"), vystup = el("poloha-stav");
    const zprava = (nadpis, text, trida = "info") => {
      vystup.innerHTML = `<div class="blok ${trida}">${trida === "chyba" ? ikona("warning", "ikona") : ""}<div><strong>${esc(nadpis)}</strong>${esc(text)}</div></div>`;
    };
    if (!("geolocation" in navigator)) {
      zprava("Polohu tento prohlížeč nezjistí.", "Napište prosím adresu bydliště do pole výše.");
      return;
    }
    const popis = tl.innerHTML;
    tl.disabled = true;
    tl.textContent = "Zjišťujeme polohu…";
    vystup.innerHTML = "";
    const hotovo = () => { tl.disabled = false; tl.innerHTML = popis; };
    navigator.geolocation.getCurrentPosition(async (poz) => {
      const lat = +poz.coords.latitude.toFixed(5), lon = +poz.coords.longitude.toFixed(5);
      try {
        const st = await D.api("/senior-taxi", { parametry: { lat, lon } });
        if (!st.kod_obce) {
          hotovo();
          zprava("Jste mimo Karlovarský kraj.", "Spoje umíme hledat jen v Karlovarském kraji. Napište prosím adresu bydliště do pole výše.");
          return;
        }
        let obec = "";
        try { obec = (await D.api(`/obce/${encodeURIComponent(st.kod_obce)}`)).obec || ""; } catch { /* název obce není nutný */ }
        stav.seniorExpres[`${lat},${lon}`] = Promise.resolve(Array.isArray(st.sluzby) ? st.sluzby : []);
        ulozBydliste({ adresa: obec ? `Moje poloha (${obec})` : "Moje poloha", lat, lon, kod_obce: st.kod_obce, zdroj: "poloha" });
      } catch (e) {
        hotovo();
        zprava("Polohu se nepodařilo ověřit.", e.message, "chyba");
      }
    }, (chyba) => {
      hotovo();
      if (chyba.code === 1) zprava("Polohu jste nepovolili.", "Nevadí. Napište adresu bydliště do pole výše. Polohu můžete později povolit v nastavení prohlížeče u adresy stránky.");
      else if (chyba.code === 3) zprava("Zjišťování polohy trvalo příliš dlouho.", "Zkuste to prosím znovu, nebo napište adresu bydliště do pole výše.");
      else zprava("Polohu se teď nepodařilo zjistit.", "Napište prosím adresu bydliště do pole výše.");
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
  }

  // --- našeptávač (vzor ARIA combobox): adresa bydliště a jméno lékaře ----------------------------
  function naseptavac(koren, o) {
    const input = koren.querySelector("input");
    const seznam = koren.querySelector("[role=listbox]");
    const stavEl = koren.querySelector(".naseptavac-stav");
    let polozky = [], aktivni = -1, poradi = 0, vybrano = false;

    function zavri() {
      seznam.hidden = true; input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant"); aktivni = -1;
    }
    function otevri() { if (polozky.length) { seznam.hidden = false; input.setAttribute("aria-expanded", "true"); } }
    function nastavAktivni(i, posunout = true) {
      aktivni = i;
      [...seznam.children].forEach((li, j) => li.setAttribute("aria-selected", j === i ? "true" : "false"));
      if (i >= 0) { const li = seznam.children[i]; input.setAttribute("aria-activedescendant", li.id); if (posunout) li.scrollIntoView({ block: "nearest" }); }
      else input.removeAttribute("aria-activedescendant");
    }
    function vykresliSeznam() {
      seznam.innerHTML = polozky.map((a, i) => `<li role="option" id="${seznam.id}-${i}" aria-selected="false">${o.html(a)}</li>`).join("");
      aktivni = -1;
      if (polozky.length) otevri(); else zavri();
    }
    function vyber(i) {
      const a = polozky[i];
      if (!a) return;
      input.value = o.text(a);
      vybrano = true;
      zavri();
      zprava("");
      o.priVyberu(a);
    }
    /** Stav pod polem (čte ho čtečka obrazovky); „nic“ = nic nenalezeno, zvýrazněné jako upozornění. */
    function zprava(text, nic = false) {
      stavEl.textContent = text || "";
      stavEl.classList.toggle("nic", !!(text && nic));
    }
    let cekani = null;
    const hledej = D.zpozdeni(async () => {
      const q = input.value.trim();
      const moje = ++poradi;
      clearTimeout(cekani);
      if (q.replace(/\s/g, "").length < o.minZnaku) {
        polozky = []; vykresliSeznam();
        zprava(q ? o.kratke : "");
        return;
      }
      // pomalé spojení: po chvíli říct, že hledáme (rychlou odpověď to nezdržuje ani nehlásí dvakrát)
      cekani = setTimeout(() => { if (moje === poradi) zprava("Hledáme…"); }, 600);
      input.setAttribute("aria-busy", "true");
      try {
        const r = await o.hledej(q);
        if (moje !== poradi) return;
        polozky = r.polozky;
        vykresliSeznam();
        zprava(r.zprava, r.nic);
      } catch (e) {
        if (moje !== poradi) return;
        polozky = []; vykresliSeznam();
        zprava(e.message, true);
      } finally {
        if (moje === poradi) { clearTimeout(cekani); input.removeAttribute("aria-busy"); }
      }
    }, o.zpozdeni || 300);

    input.addEventListener("input", () => { vybrano = false; o.priVyberu(null); hledej(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        if (!polozky.length) return;
        e.preventDefault(); otevri(); nastavAktivni(e.altKey && aktivni < 0 ? -1 : (aktivni + 1) % polozky.length);
      } else if (e.key === "ArrowUp") {
        if (!polozky.length) return;
        e.preventDefault(); otevri(); nastavAktivni(aktivni <= 0 ? polozky.length - 1 : aktivni - 1);
      } else if (e.key === "Enter") {
        if (!seznam.hidden && (aktivni >= 0 || polozky.length === 1)) { e.preventDefault(); vyber(Math.max(aktivni, 0)); }
        else if (o.enterBezVyberu === false) {   // adresa: Enter bez výběru formulář neodesílá, ukáže na nabídku
          e.preventDefault();
          if (polozky.length) { otevri(); nastavAktivni(0); }
        }
      } else if (e.key === "Escape") {
        // Esc: zavřít nabídku; když je zavřená, smazat napsaný text (vzor ARIA combobox)
        if (!seznam.hidden) { e.preventDefault(); zavri(); }
        else if (input.value) { e.preventDefault(); input.value = ""; ++poradi; polozky = []; vykresliSeznam(); zprava(""); o.priVyberu(null); }
      } else if (e.key === "Tab") zavri();
    });
    input.addEventListener("blur", () => setTimeout(zavri, 150));
    input.addEventListener("focus", () => { if (!vybrano && polozky.length && input.value.trim()) otevri(); });
    seznam.addEventListener("mousedown", (e) => e.preventDefault());   // fokus zůstane v poli
    seznam.addEventListener("mousemove", (e) => {
      const li = e.target.closest("[role=option]");
      const i = li ? [...seznam.children].indexOf(li) : -1;
      if (i >= 0 && i !== aktivni) nastavAktivni(i, false);
    });
    seznam.addEventListener("click", (e) => {
      const li = e.target.closest("[role=option]");
      if (li) vyber([...seznam.children].indexOf(li));
    });
    return { input, stavEl };
  }

  // --- 2 Kam: Můj lékař (nabídka podle jména, seřazená podle spojení z bydliště) ---------------
  function napojLekare() {
    const n = naseptavac(el("nas-lekar"), {
      minZnaku: 2,
      zpozdeni: 350,
      kratke: "Napište aspoň 2 písmena.",
      html: (c) => {
        const kde = [typCile(c), c.adresa || c.obec].filter(Boolean).join(", ");
        return `<span class="nv-nazev">${esc(c.nazev)}</span>${kde ? `<span class="nv-popis">${esc(kde)}</span>` : ""}`;
      },
      text: (c) => c.nazev,
      hledej: async (q) => {
        const b = stav.bydliste;
        let cile, celkem;
        if (b) {
          ({ cile, celkem } = await cileSeSpojenim({ q, typ: TYPY_LEKARU, lat: b.lat, lon: b.lon,
            datum: D.isoDatum(pracovniDenOd(vychoziDen())), cas: "07:00", limit: NAVRHU }));
        } else {
          const d = await D.api("/cile", { parametry: { q, typ: TYPY_LEKARU, limit: NAVRHU } });
          cile = d.cile || []; celkem = d.pocet || cile.length;
        }
        cile.forEach((c) => { stav.cileCache[c.id] = c; });
        return { polozky: cile, zprava: !cile.length
          ? "Nikoho takového jsme nenašli. Zkuste jen příjmení nebo název obce."
          : celkem > cile.length
            ? `Našli jsme ${pocetMist(celkem)}, v nabídce je ${cile.length}${b ? ", kam se dostanete nejlépe" : ""}. Vyberte šipkami nebo klepnutím, nebo doplňte příjmení či obec.`
            : `${velke(pocetMist(cile.length))} v nabídce. Vyberte šipkami nebo klepnutím.` };
      },
      priVyberu: (c) => {
        if (!c) {   // píše dál: výběr se ruší, platí hledaný text
          f.lekar = null;
          f.q = el("lekar-hledat").value;
          nastavChybu("lekar-chyba", "");
          zmena();
          return;
        }
        f.lekar = c;
        f.q = c.nazev;
        nastavChybu("lekar-chyba", "");
        n.stavEl.textContent = `Vybráno: ${jmenoMista(c)}. Teď stiskněte Najít spoj.`;
        zmena();
      },
    });
  }

  // --- 2 Kam: Moje místa (jedním klepnutím rovnou spoje) -----------------------------------------
  function vykresliMojeMista() {
    const obal = el("moje-mista-obal");
    const m = mojeMista();
    const aktualni = f.kam === "misto" && f.misto ? f.misto.id : null;
    const jine = aktualni && !m.some((x) => x.id === aktualni) ? f.misto : null;   // místo z odkazu, které není mezi Mými místy
    if (!m.length && !jine) { obal.innerHTML = ""; return; }
    const radek = (x, ulozene) => {
      const popis = [typCile(x), ulice(x.adresa)].filter(Boolean).join(", ");
      const je = x.id === aktualni;
      return `<li class="zkratka-radek">
        <button type="button" class="zkratka${je ? " vybrano" : ""}" data-cil="${esc(x.id)}"${je ? ' aria-current="true"' : ""}>
          <span class="mv-text"><span class="mv-nazev">${esc(x.nazev ? jmenoMista(x) : "Vybrané místo")}</span>${popis ? `<span class="mv-popis">${esc(popis)}</span>` : ""}</span>
          ${ikona(je ? "check-circle" : "caret-right", "mv-sipka")}
        </button>
        ${ulozene ? `<button type="button" class="odkaz-tlacitko odebrat" data-odebrat="${esc(x.id)}">Odebrat<span class="sr"> ${esc(jmenoMista(x))} z Mých míst</span></button>` : ""}
      </li>`;
    };
    obal.innerHTML = `
      <div class="moje-mista">
        <p class="pole-popisek" id="moje-popisek">${m.length ? "Moje místa" : "Vybrané místo"}</p>
        ${m.length ? `<p class="napoveda-pole" id="moje-napoveda">Klepnutím hned ukážeme spoje. Místa jsou uložená jen v tomto prohlížeči.</p>` : ""}
        <ul class="zkratky" aria-labelledby="moje-popisek"${m.length ? ' aria-describedby="moje-napoveda"' : ""}>
          ${jine ? radek(jine, false) : ""}${m.map((x) => radek(x, true)).join("")}
        </ul>
      </div>
      <p class="pole-popisek kam-jine">${m.length ? "Nebo vyberte, kam potřebujete" : "Nebo vyberte jiné místo"}</p>`;
  }

  function napojMojeMista() {
    const obal = el("moje-mista-obal");
    obal.addEventListener("click", (e) => {
      const z = e.target.closest("[data-cil]");
      if (z) {
        const id = z.dataset.cil;
        const x = ulozeneMisto(id) || (f.misto && f.misto.id === id ? f.misto : null);
        if (!x) return;
        f.kam = "misto";
        f.misto = x;
        nastavChybu("kam-chyba", "");
        nastavKam();
        odesli();
        return;
      }
      const b = e.target.closest("[data-odebrat]");
      if (!b) return;
      const id = b.dataset.odebrat;
      const i = [...obal.querySelectorAll("[data-odebrat]")].findIndex((x) => x.dataset.odebrat === id);
      const x = ulozeneMisto(id);
      odeberMisto(id);
      vykresliMojeMista();
      hlas(`${x ? jmenoMista(x) : "Místo"}: odebráno z Mých míst.`);
      const zbyle = [...obal.querySelectorAll("[data-cil]")];
      if (zbyle.length) zbyle[Math.min(i, zbyle.length - 1)].focus();
      else (formular.querySelector('input[name="kam"]:checked') || el("kam-r-lekar")).focus();
    });
  }

  // --- 3 Kdy: den a čas odjezdu ------------------------------------------------------------------
  function vykresliKdy(fokus) {
    const iso = D.isoDatum(f.den);
    const rychle = [dnes(), posun(dnes(), 1)];
    const dalsi = Array.from({ length: 5 }, (_, i) => posun(dnes(), i + 2));
    if (![...rychle, ...dalsi].some((d) => D.isoDatum(d) === iso)) dalsi.push(f.den);
    const vDalsich = dalsi.some((d) => D.isoDatum(d) === iso);
    const cas = casFormulare();
    const casy = [];
    for (let h = 4; h <= 21; h++) casy.push(`${h}:00`);
    const ted = jeDnes(f.den) ? vychoziCas(f.den) : null;
    if (ted && !casy.includes(ted)) casy.push(ted);
    if (!casy.includes(cas)) casy.push(cas);
    casy.sort((a, b) => minutDne(a) - minutDne(b));
    el("kdy-obsah").innerHTML = `
      <div class="kdy-radek">
        <div class="kdy-den" role="group" aria-labelledby="den-popisek">
          <p class="pole-popisek" id="den-popisek">Den</p>
          <div class="dny-radek">
            ${rychle.map((d) => { const i = D.isoDatum(d); return `<button type="button" class="den" data-den="${i}" aria-pressed="${i === iso}">${esc(popisDne(d))}</button>`; }).join("")}
            <select class="den-vyber${vDalsich ? " vybrano" : ""}" id="den-jiny" aria-label="Jiný den">
              <option value="">Jiný den…</option>
              ${dalsi.map((d) => { const i = D.isoDatum(d); return `<option value="${i}" ${i === iso ? "selected" : ""}>${esc(popisDne(d))}</option>`; }).join("")}
            </select>
          </div>
        </div>
        <div class="kdy-cas">
          <label for="cas-od">Odjezd od</label>
          <select id="cas-od">${casy.map((c) => `<option value="${c}" ${c === cas ? "selected" : ""}>${c}${c === ted && c !== "7:00" ? " (teď)" : ""}</option>`).join("")}</select>
        </div>
      </div>`;
    if (fokus) { const x = el("kdy-obsah").querySelector(fokus); if (x) x.focus(); }
  }

  function napojKdy() {
    const obal = el("kdy-obsah");
    obal.addEventListener("click", (e) => {
      const b = e.target.closest(".den");
      if (!b || b.getAttribute("aria-pressed") === "true") return;
      f.den = denZ(b.dataset.den);
      vykresliKdy(`.den[data-den="${b.dataset.den}"]`);
      zmena();
    });
    obal.addEventListener("change", (e) => {
      if (e.target.id === "den-jiny" && e.target.value) {
        f.den = denZ(e.target.value);
        vykresliKdy("#den-jiny");
        zmena();
      } else if (e.target.id === "cas-od") {
        f.cas = e.target.value === vychoziCas(f.den) ? null : e.target.value;
        zmena();
      }
    });
  }

  // --- formulář podle adresy stránky -----------------------------------------------------------
  function synchronizuj(krok, p) {
    if (krok === "mista" || krok === "spojeni") {
      f.den = vychoziDen(p.get("den"));
      f.cas = platnyCas(p.get("cas"));
    }
    if (krok === "mista") {
      const typ = p.get("typ"), q = (p.get("q") || "").trim().slice(0, 80);
      if (SPOLECNE[typ]) f.kam = typ;
      else if (OBORY[typ]) { f.kam = "novy"; f.obor = typ; }
      else if (q) { f.kam = "lekar"; f.q = q; f.lekar = null; }
      f.misto = null;
    } else if (krok === "spojeni") {
      const id = p.get("cil");
      const vybrany = (f.kam === "misto" && f.misto && f.misto.id === id) || (f.kam === "lekar" && f.lekar && f.lekar.id === id);
      // ze seznamu míst: formulář dál ukazuje hledání, ze kterého místo je; jinak jedno konkrétní místo
      if (!stav.posledniMista && !vybrany) {
        f.kam = "misto";
        f.misto = ulozeneMisto(id) || stav.cileCache[id] || { id, nazev: "" };
      }
    }
    nastavKam();
    vykresliKdy();
    stav.hashFormulare = cilovyHash();
  }

  // --- vykreslení: formulář + výsledek pod ním ---------------------------------------------------
  function vykresli(volby = {}) {
    let { krok, p } = ctiHash();
    if (krok === "bydliste") {          // starý odkaz na krok Bydliště → otevřít pole Odkud
      stav.upravujiOdkud = true;
      vykresliOdkud();
      bezHashe();
      krok = "";
      if (!stav.prvni) volby.fokus = volby.fokus || "#adresa";
    } else if (krok === "kam") {        // starý odkaz na krok Kam (i s hledaným lékařem)
      const q = (p.get("q") || "").trim().slice(0, 80);
      if (q) { f.kam = "lekar"; f.q = q; f.lekar = null; }
      bezHashe();
      krok = "";
    }
    if (krok !== "mista" && krok !== "spojeni") krok = "";
    stav.nacitani++;
    stav.posledniHash = location.hash;
    if (!krok) { stav.posledniMista = null; stav.nazevVysledku = ""; }
    synchronizuj(krok, p);

    if (!krok) {
      vysledek.innerHTML = "";
      document.title = "Najít spoj – Dojedeme";
    } else if (!stav.bydliste) {
      vysledekBezBydliste();
    } else if (krok === "mista") {
      if (!krokMista(p)) return;
    } else if (!krokSpojeni(p)) return;

    stav.maVysledky = !!krok;
    oddilVysledky.hidden = !krok;
    formular.classList.toggle("sbaleno", !!krok && !!stav.bydliste && !stav.upravuji);
    zmena();
    vykresliSe();

    if (volby.fokus) {
      const x = document.querySelector(volby.fokus);
      if (x) x.focus();
    } else if (!stav.prvni) {
      if (krok) {
        // nový výsledek: posunout k němu (na mobilu i se souhrnem hledání) a fokus na jeho nadpis (h2)
        const sbaleny = formular.classList.contains("sbaleno") && getComputedStyle(el("hledani-souhrn")).display !== "none";
        posunK(sbaleny ? formular : oddilVysledky);
        const n = el("vysledky-nadpis");
        if (n) n.focus({ preventScroll: true });
      } else {
        window.scrollTo(0, 0);
        el("hledani-nadpis").focus({ preventScroll: true });
      }
    }
    stav.prvni = false;
  }

  /** Posune stránku tak, aby prvek začínal hned pod lepící hlavičkou webu (její výška se mění podle šířky). */
  function posunK(prvek) {
    const h = document.querySelector(".web-hlavicka");
    const lepi = h && getComputedStyle(h).position === "sticky" ? h.getBoundingClientRect().height : 0;
    window.scrollTo(0, Math.max(0, prvek.getBoundingClientRect().top + window.scrollY - lepi - 8));
  }

  function vysledekBezBydliste() {
    document.title = "Najít spoj – Dojedeme";
    vysledek.innerHTML = `
      <div class="oddil-hlava">
        <h2 id="vysledky-nadpis" tabindex="-1">Nejdřív vyplňte, odkud pojedete</h2>
        <p>Spoje hledáme z vašeho bydliště. Napište adresu nahoře v části Odkud pojedete a vyberte ji ze seznamu. Výsledek se tu pak ukáže sám.</p>
      </div>
      <div class="akce"><button type="button" class="tlacitko vedlejsi" id="vyplnit-adresu">Vyplnit adresu</button></div>`;
    el("vyplnit-adresu").addEventListener("click", () => {
      const a = el("adresa");
      if (a) { a.scrollIntoView({ block: "center" }); a.focus({ preventScroll: true }); }
    });
  }

  /** Senior Expres v obci bydliště: pod formulářem, dokud není výsledek. */
  function vykresliSe() {
    const obal = el("se-bydliste");
    const kolo = ++stav.seKolo;
    if (!stav.bydliste || stav.maVysledky) { obal.innerHTML = ""; return; }
    seniorExpresBydliste(stav.bydliste).then((sluzby) => {
      if (kolo !== stav.seKolo) return;
      obal.innerHTML = seniorExpres(sluzby, null, "se-kam");
    });
  }

  function kostra(n = 3) {
    return `<div class="kostra" aria-hidden="true">${Array.from({ length: n }, () =>
      `<div class="kostra-radek"><div class="skeleton" style="width:55%;height:28px"></div><div class="skeleton" style="width:85%"></div><div class="skeleton" style="width:70%"></div></div>`).join("")}</div>`;
  }

  function chybaBlok(nadpis, zprava, akce = true) {
    return `<div class="blok chyba" role="alert">${ikona("warning", "ikona")}<div><strong>${esc(nadpis)}</strong>${esc(zprava)}</div></div>` +
      (akce ? `<div class="akce"><button type="button" class="tlacitko vedlejsi" data-akce="znovu">Zkusit znovu</button></div>` : "");
  }

  function upozorneni2022() {   // upozornění na stáří dat kraje na webu nezobrazujeme (rozhodnutí týmu 2026-10-10)
    return "";
  }
  function nabiraBlok() {
    return `<p class="odznaky"><span class="odznak nabira">${ikona("check-circle")}Přijímá nové pacienty</span></p>${upozorneni2022()}`;
  }

  /** Otevírací doba jako malý seznam dnů a časů (Dojedeme.hodiny); když ji nejde rozebrat, původní text. */
  function hodinyHtml(text, uroven = "h3") {
    const t = String(text || "").trim();
    if (!t) return "";
    let radky = null;
    try { radky = typeof D.hodiny === "function" ? D.hodiny(t) : null; } catch { radky = null; }
    const nadpis = `<${uroven} class="hodiny-nadpis">Otevírací doba</${uroven}>`;   // úroveň podle místa: h4 v seznamu míst, h3 u spojení
    if (radky && radky.length) {
      return `<div class="hodiny">${nadpis}<dl>${radky.map((r) =>
        `<div><dt>${esc(r.dny)}</dt><dd>${esc(r.cas)}</dd></div>`).join("")}</dl></div>`;
    }
    return `<div class="hodiny">${nadpis}<p>${esc(velke(t.replace(/-/g, "–")))}</p></div>`;
  }
  function jeNeprerusene(text) { return /^\s*nepřetržitě\s*$/i.test(String(text || "")); }

  function nactiZdroj() {
    const vypis = () => {
      const z = el("zdroj-jr");
      if (z && stav.zdroj) z.textContent = `Jízdní řády CIS JŘ, platí do ${D.datum(stav.zdroj)}. Spoje počítá Dojedeme z otevřených dat.`;
    };
    if (stav.zdroj) return vypis();
    D.api("/zdravi").then((d) => { stav.zdroj = d.jizdni_rady && d.jizdni_rady.plati_do; vypis(); }).catch(() => {});
  }

  // --- Senior Expres (jen když ho obec bydliště má) -------------------------------------------
  /** Služby Senior Expres v obci bydliště (Promise, jeden dotaz na bydliště). */
  function seniorExpresBydliste(b) {
    const klic = `${b.lat},${b.lon}`;
    if (!stav.seniorExpres[klic]) {
      stav.seniorExpres[klic] = D.api("/senior-taxi", { parametry: { lat: b.lat, lon: b.lon } })
        .then((d) => (Array.isArray(d.sluzby) ? d.sluzby : []))
        .catch(() => { delete stav.seniorExpres[klic]; return []; });
    }
    return stav.seniorExpres[klic];
  }

  /** „SENIOR DOPRAVA CHEB“ (v datech obce velkými písmeny) → „Senior Doprava Cheb“. */
  function hezkyNazev(n) {
    n = String(n || "").trim();
    return n && n === n.toUpperCase() && /[A-ZÁ-Ž]{3}/.test(n) ? n.toLowerCase().replace(/(^|[\s-])(\S)/g, (m, a, c) => a + c.toUpperCase()) : n;
  }
  /** Senior Expres jako štíhlý pruh: ikona, název, (věta), Podmínky a cena; vpravo tlačítko s číslem.
   *  Prázdný seznam = nic (obec službu nemá, nezmiňujeme ji). uvod = null: bez věty (pod adresou ve formuláři). */
  function seniorExpres(sluzby, uvod, prefix = "se") {
    if (!Array.isArray(sluzby) || !sluzby.length) return "";
    return sluzby.map((s, i) => {
      const id = `${prefix}-${i}`;
      const jmeno = hezkyNazev(s.nazev) || "Senior Expres";
      const podminky = String(s.podminky || "").split(";").map((x) => x.trim()).filter(Boolean);
      const zdroj = bezpecnyOdkaz(s.zdroj);
      let web = "";
      try { web = zdroj ? new URL(zdroj).hostname.replace(/^www\./, "") : ""; } catch { web = ""; }
      const provoz = s.provoz ? rozsahy(String(s.provoz).replace(/prac\.\s*dny/gi, "pracovní dny")) : "";
      // některé obce mají v datech dvě čísla („+420603282867;+420724181464“): volá se na první, další jsou v podrobnostech
      const telefony = String(s.telefon || "").split(/[;,]/).map((t) => t.trim()).filter(Boolean);
      const udaje = [
        podminky.length ? `<div><dt>Podmínky</dt><dd>${podminky.map((x) => `<span class="radek">${esc(velke(x))}</span>`).join("")}</dd></div>` : "",
        s.cena ? `<div><dt>Cena</dt><dd>${esc(rozsahy(s.cena))}</dd></div>` : "",
        provoz ? `<div><dt>Kdy jezdí</dt><dd>${esc(velke(provoz))}</dd></div>` : "",
        s.provozovatel ? `<div><dt>Provozuje</dt><dd>${esc(s.provozovatel)}</dd></div>` : "",
        telefony.length > 1 ? `<div><dt>Další telefon</dt><dd>${telefony.slice(1).map((t) => `<a href="${esc(D.telefonOdkaz(t))}" class="nezalomit">${esc(D.telefon(t))}</a>`).join(", ")}</dd></div>` : "",
      ].join("");
      return `<section class="senior-expres" aria-labelledby="${id}">
        <span class="se-ikona" aria-hidden="true">${ikona("taxi")}</span>
        <div class="se-telo">
          <h3 class="se-nadpis" id="${id}"><span class="se-pred">V obci jezdí</span> ${esc(jmeno)}</h3>
          ${uvod ? `<p class="se-uvod">${esc(uvod)}</p>` : ""}
          ${udaje || zdroj ? `<details class="se-vice"><summary>Podmínky a cena</summary>
            ${udaje ? `<dl class="se-udaje">${udaje}</dl>` : ""}
            ${zdroj ? `<p class="zdroj">Zdroj: <a href="${esc(zdroj)}" rel="noopener">${esc(web || "stránky provozovatele")}</a></p>` : ""}</details>` : ""}
        </div>
        ${telefony.length
          ? `<a class="tlacitko signal se-volat" href="${esc(D.telefonOdkaz(telefony[0]))}">${ikona("phone")}<span class="sr">Zavolat ${esc(jmeno)}: </span>${esc(D.telefon(telefony[0]))}</a>`
          : `<p class="se-bez-tel">Telefon zjistíte na obecním úřadě.</p>`}
      </section>`;
    }).join("");
  }

  // --- výsledek: seznam míst -----------------------------------------------------------------
  function krokMista(p) {
    const typKlic = p.get("typ"), q = (p.get("q") || "").trim().slice(0, 80);
    const spolecne = SPOLECNE[typKlic], obor = OBORY[typKlic];
    if (!spolecne && !obor && !q) { bezHashe(); vykresli(); return false; }
    const lekari = !spolecne && !obor;   // Můj lékař: hledání podle jména
    const novy = !!obor && p.get("nabira") === "1";
    const den = vychoziDen(p.get("den"));
    const cas = platnyCas(p.get("cas")) || vychoziCas(den);
    stav.posledniMista = location.hash;
    const nadpis = lekari ? `Lékaři podle hledání „${q}“` : spolecne ? spolecne.nazev : novy ? obor.novy : obor.vsichni;
    const lead = lekari ? "Vyberte svého lékaře a stiskněte Zobrazit spoje. Uložíme ho mezi Moje místa v tomto prohlížeči. Nahoře jsou ti, ke kterým se spojem dostanete nejdřív."
      : spolecne ? (spolecne.lead ? spolecne.lead + " " : "") + "Nahoře jsou místa, kam se spojem dostanete nejdřív."
        : novy ? "Lékaři, kteří podle seznamu Karlovarského kraje přijímají nové pacienty. Nahoře jsou ti, ke kterým se spojem dostanete nejdřív."
          : "U většiny z nich nevíme, jestli přijímají nové pacienty. Zavolejte a zeptejte se. Nahoře jsou ti, ke kterým se spojem dostanete nejdřív.";
    document.title = `${lekari ? "Hledání lékaře" : nadpis} – Najít spoj – Dojedeme`;
    vysledek.innerHTML = `
      <div class="oddil-hlava">
        <h2 id="vysledky-nadpis" tabindex="-1">${esc(nadpis)}</h2>
        <p>${esc(lead)}</p>
      </div>
      <p class="male poznamka">Časy jsou pro odjezd ${esc(denSlovy(den))} od ${esc(cas)} z vašeho bydliště.</p>
      <div id="vysledky" class="vysledky" tabindex="-1" aria-busy="true">${kostra(3)}</div>
      <p class="zdroj" id="zdroj-jr"></p>
      <p class="zdroj">${obor || lekari
        ? "Lékaři: Národní registr poskytovatelů zdravotních služeb (ÚZIS) a seznam Karlovarského kraje z 11. 4. 2022."
        : "Místa: otevřená data Karlovarského kraje a Národní registr poskytovatelů zdravotních služeb (ÚZIS)."}</p>`;

    nactiMista({ typKlic, spolecne, obor, novy, lekari, q, den, cas, p });
    nactiZdroj();
    return true;
  }

  function dotazNaMista(o, nabira) {
    const b = stav.bydliste;
    const zaklad = { lat: b.lat, lon: b.lon, datum: D.isoDatum(o.den), cas: o.cas, limit: LIMIT };
    // úřady: jen ty, pod které obec bydliště patří (obecní úřad a ORP), ne nejbližší
    const parametry = o.lekari ? { ...zaklad, q: o.q, typ: TYPY_LEKARU }
      : { ...zaklad, typ: o.spolecne ? o.spolecne.typ : o.typKlic, nabira: nabira ? 1 : null, urady: (o.spolecne && o.spolecne.urady) || null };
    return cileSeSpojenim(parametry).then((d) => {
      d.cile.forEach((c) => { stav.cileCache[c.id] = c; });
      return d;
    });
  }

  async function nactiMista(o) {
    const moje = stav.nacitani;
    const vysledky = el("vysledky");
    const smiseny = o.lekari || (o.spolecne ? o.spolecne.typ : o.typKlic).includes(",");
    // odkaz na spoje nese den a čas ze seznamu
    const odkaz = (c) => hashZ("spojeni", { cil: c.id, den: o.p.get("den"), cas: platnyCas(o.p.get("cas")) });
    hlas("Hledáme místa a spoje…");
    try {
      let { cile, celkem } = await dotazNaMista(o, o.novy);
      if (moje !== stav.nacitani) return;
      let uvod = "", nikdo = false;
      if (o.novy && !cile.length) {
        // nikdo z oboru podle seznamu kraje nenabírá → říct to rovnou a ukázat všechny lékaře oboru
        nikdo = true;
        uvod = `<div class="prazdny nikdo">
            <h3>Podle seznamu kraje teď nové pacienty nepřijímá nikdo v dosahu</h3>
            <p>Zavolejte lékařům níže a zeptejte se, jestli nové pacienty berou.</p>
          </div>
          <h3 class="nadpis-mensi">${esc(o.obor.vsichni)}</h3>`;
        ({ cile, celkem } = await dotazNaMista(o, false));
        if (moje !== stav.nacitani) return;
      }
      vysledky.removeAttribute("aria-busy");
      if (!cile.length) {
        vysledky.innerHTML = `${uvod}<div class="prazdny">
          <h3>Nic jsme nenašli</h3>
          <p>${o.lekari
            ? "Nikoho takového jsme nenašli. Zkuste nahoře v poli Kam jen příjmení nebo název obce."
            : "V okolí vašeho bydliště takové místo v našich datech není. Zkuste nahoře v poli Kam jiné místo."}</p>
          <div class="akce"><button type="button" class="tlacitko" data-akce="upravit">Upravit hledání</button></div></div>`;
        vysledky.querySelector("[data-akce=upravit]").addEventListener("click", () => upravitKam());
        hlas("Nic jsme nenašli.");
        return;
      }
      const iso = D.isoDatum(o.den);
      // v tento den odsud nic nejede (typicky víkend na vesnici) – rovnou nabídnout nejbližší pracovní den
      const nicNejede = cile.every((c) => c.dostupne === false || !c.odjezd);
      const dalsi = dalsiPracovniDen(o.den);
      vysledky.innerHTML = `
        ${uvod}
        ${nicNejede ? `<div class="blok upozorneni nic-nejede">${ikona("warning", "ikona")}<div><strong>${esc(velke(denSlovy(o.den)))} od ${esc(o.cas)} z vašeho bydliště nejede žádný spoj.</strong>
          Malé obce mají spoje hlavně v pracovní dny. Místa níže jsou seřazená jen podle vzdálenosti.
          <p class="akce"><button type="button" class="tlacitko" data-akce="den" data-den="${D.isoDatum(dalsi)}">Zkusit ${esc(denSlovy(dalsi))}</button></p></div></div>` : ""}
        <p class="pocet">${o.lekari && celkem > cile.length
          ? `Našli jsme ${pocetMist(celkem)}. Ukazujeme ${cile.length}, kam se dostanete nejlépe. Pokud svého lékaře nevidíte, upřesněte hledání nahoře.`
          : velke(pocetMist(cile.length))}</p>
        <ol class="seznam-mist">${cile.map((c, i) => radekMista(c, odkaz(c), smiseny, o.lekari ? i : null)).join("")}</ol>
        ${o.novy && !nikdo ? `<p class="dalsi-lekari">Nové pacienty mohou přijímat i další lékaři.
          <a href="${hashZ("mista", { typ: o.typKlic, den: o.p.get("den"), cas: platnyCas(o.p.get("cas")) })}">Zobrazit ${esc(o.obor.odkaz)} v dosahu</a></p>` : ""}`;
      const tlDen = vysledky.querySelector("[data-akce=den]");
      if (tlDen) tlDen.addEventListener("click", () => zmen({ den: tlDen.dataset.den, cas: null }, "#vysledky"));
      if (o.lekari) {   // vybraný lékař se uloží mezi Moje místa
        vysledky.addEventListener("click", (e) => {
          const a = e.target.closest("a[data-ulozit]");
          if (a && cile[+a.dataset.ulozit]) { pridejMisto(cile[+a.dataset.ulozit]); stav.posledniMista = location.hash; }
        });
      }
      hlas(nikdo ? `Podle seznamu kraje nové pacienty nikdo v dosahu nepřijímá. Ukazujeme všechny lékaře oboru v dosahu, celkem ${pocetMist(cile.length)}.`
        : nicNejede ? `${velke(denSlovy(o.den))} odsud nejede žádný spoj. Zkuste ${denSlovy(dalsi)}.`
          : `Našli jsme ${pocetMist(cile.length)}. Seřazeno podle spojení.`);
    } catch (e) {
      if (moje !== stav.nacitani) return;
      vysledky.removeAttribute("aria-busy");
      vysledky.innerHTML = chybaBlok("Místa se nepodařilo načíst.", `${e.message} Zkuste to prosím za chvíli znovu.`);
      vysledky.querySelector("[data-akce=znovu]").addEventListener("click", () => vykresli({ fokus: "#vysledky" }));
    }
  }

  /** Rozbalí formulář (mobil) a přesune fokus do pole Kam. */
  function upravitKam() {
    stav.upravuji = true;
    formular.classList.remove("sbaleno");
    const cil = formular.querySelector('input[name="kam"]:checked') || el("kam-r-lekar");
    el("pole-kam").scrollIntoView({ block: "start" });
    cil.focus({ preventScroll: true });
  }

  function radekMista(c, odkaz, smiseny, ulozit) {
    const tel = (c.telefon || [])[0];
    const dalsiTel = (c.telefon || []).slice(1);
    const dostupne = c.dostupne !== false && c.odjezd;
    const kde = c.adresa || c.obec || "";
    return `<li class="misto">
      <h3 class="misto-nazev">${esc(c.nazev)}</h3>
      <p class="misto-kde">${smiseny && typCile(c) ? `<span class="radek misto-typ">${esc(typCile(c))}</span>` : ""}${kde ? `<span class="radek">${esc(kde)}</span>` : ""}</p>
      ${c.role ? `<p class="misto-role">${esc(c.role)}</p>` : ""}
      ${c.typ === "urad_orp" ? `<p class="male">Občanské průkazy, pasy a řidičské průkazy.</p>` : ""}
      ${dostupne
        ? `<p class="misto-spoj">${ikona("bus")}<span><span class="radek">Odjezd <b>${esc(c.odjezd)}</b>, příjezd <b>${esc(c.prijezd)}</b></span><span class="radek">${D.minuty(c.cesta_min)}, ${D.prestupy(c.prestupy)}</span></span></p>`
        : `<p class="misto-spoj nedostupne">V tento den se sem spojem nedostanete.</p>`}
      ${c.hodiny && !jeNeprerusene(c.hodiny) ? hodinyHtml(c.hodiny, "h4") : ""}
      ${c.nabira ? nabiraBlok() : ""}
      <div class="akce">
        <a class="tlacitko vedlejsi" href="${esc(odkaz)}"${ulozit !== null && ulozit !== undefined ? ` data-ulozit="${ulozit}"` : ""}>Zobrazit spoje<span class="sr">: ${esc(c.nazev)}</span></a>
        ${tel ? `<a class="telefon" href="${esc(D.telefonOdkaz(tel))}">${ikona("phone")}<span>Zavolat <span class="nezalomit">${esc(D.telefon(tel))}</span></span></a>` : ""}
      </div>
      ${dalsiTel.length ? `<p class="male">Další telefon: ${dalsiTel.map((t) => `<a href="${esc(D.telefonOdkaz(t))}" class="nezalomit">${esc(D.telefon(t))}</a>`).join(", ")}</p>` : ""}
    </li>`;
  }

  // --- výsledek: spoje tam a zpět ---------------------------------------------------------------
  function krokSpojeni(p) {
    const cilId = p.get("cil");
    if (!cilId) { bezHashe(); vykresli(); return false; }
    const den = vychoziDen(p.get("den"));
    const o = {
      cilId, den,
      smer: p.get("smer") === "zpet" ? "zpet" : "tam",
      cas: platnyCas(p.get("cas")) || vychoziCas(den),
      pobyt: POBYT.includes(+p.get("pobyt")) ? +p.get("pobyt") : 45,
    };
    const znamy = stav.cileCache[cilId] || ulozeneMisto(cilId) || (f.misto && f.misto.id === cilId && f.misto.nazev ? f.misto : null);
    stav.nazevVysledku = znamy ? jmenoMista(znamy) : "";
    document.title = `${znamy ? znamy.nazev : "Spojení"} – Najít spoj – Dojedeme`;
    vysledek.innerHTML = `
      ${stav.posledniMista ? `<a class="zpet" href="${esc(stav.posledniMista)}">Zpět na seznam míst</a>` : ""}
      <h2 id="vysledky-nadpis" class="spoj-nadpis" tabindex="-1">${esc(znamy ? znamy.nazev : "Spojení")}</h2>
      <div id="spoj-cil" class="spoj-cil">${znamy ? hlavickaCile(znamy) : ""}</div>
      <div class="pobyt-pole"><label for="volba-pobyt">Jak dlouho tam budete</label>
        <select id="volba-pobyt">${POBYT.map((m) => `<option value="${m}" ${m === o.pobyt ? "selected" : ""}>${D.minuty(m)}</option>`).join("")}</select></div>
      <div id="spoj-obsah" class="spoj-obsah" tabindex="-1" aria-busy="true">${kostra(2)}</div>
      <p class="zdroj" id="zdroj-jr"></p>`;

    el("volba-pobyt").addEventListener("change", (e) => zmen({ pobyt: e.target.value }, "#volba-pobyt"));
    nactiSpojeni(o);
    nactiZdroj();
    return true;
  }

  function hlavickaCile(c) {
    const tel = (c.telefon || [])[0];
    const kde = c.adresa || c.obec || "";
    return `<p class="misto-kde">${typCile(c) ? `<span class="radek misto-typ">${esc(typCile(c))}</span>` : ""}${kde ? `<span class="radek">${esc(kde)}</span>` : ""}</p>
      ${hodinyHtml(c.hodiny, "h3")}
      ${c.nabira ? nabiraBlok() : ""}
      ${tel ? `<p><a class="telefon" href="${esc(D.telefonOdkaz(tel))}">${ikona("phone")}<span>Zavolat <span class="nezalomit">${esc(D.telefon(tel))}</span></span></a></p>` : ""}`;
  }

  async function nactiSpojeni(o) {
    const moje = stav.nacitani;
    const obsah = el("spoj-obsah");
    const b = stav.bydliste;
    hlas("Hledáme spoje…");
    try {
      const d = await D.api("/spojeni", { parametry: {
        z_lat: b.lat, z_lon: b.lon, cil_id: o.cilId, datum: D.isoDatum(o.den), cas: o.cas, pocet: 3, pobyt: o.pobyt } });
      if (moje !== stav.nacitani) return;
      stav.cileCache[d.cil.id] = { ...stav.cileCache[d.cil.id], ...d.cil };
      if (ulozeneMisto(d.cil.id)) pridejMisto(d.cil);   // aktuální název a adresa v Mých místech
      if (f.kam === "misto" && f.misto && f.misto.id === d.cil.id) { f.misto = { ...f.misto, ...d.cil }; vykresliMojeMista(); }
      stav.nazevVysledku = jmenoMista(d.cil);
      vykresliSouhrn();
      el("vysledky-nadpis").textContent = d.cil.nazev;
      el("spoj-cil").innerHTML = hlavickaCile(d.cil);
      document.title = `${d.cil.nazev} – Najít spoj – Dojedeme`;
      obsah.removeAttribute("aria-busy");
      obsah.innerHTML = vykresliSpojeni(d, o);
      napojSpojeni(obsah, d, o);
      hlas(souhrn(d));
      const fokus = stav.fokusPoNacteni;
      stav.fokusPoNacteni = null;
      if (fokus) { const x = obsah.querySelector(fokus); if (x) x.focus(); }
    } catch (e) {
      if (moje !== stav.nacitani) return;
      obsah.removeAttribute("aria-busy");
      obsah.innerHTML = chybaBlok("Spoje se nepodařilo načíst.", `${e.message} Zkuste to prosím za chvíli znovu, nebo zvolte jiný den.`);
      obsah.querySelector("[data-akce=znovu]").addEventListener("click", () => vykresli({ fokus: "#spoj-obsah" }));
    }
  }

  function souhrn(d) {
    if (!d.tam || !d.tam.length) return "V tento den jsme spoj nenašli.";
    if (d.jen_pesky) return `Cíl je blízko, dojdete pěšky za ${D.minuty(d.tam[0].minut)}.`;
    const j = prvniJizda(d.tam[0]);
    let t = `Nejbližší spoj odjíždí ${vCas(j ? j.odjezd : d.tam[0].odjezd)}, příjezd ${vCas(d.tam[0].prijezd)}.`;
    t += d.zpet_mozne && d.posledni_zpet ? ` Poslední spoj zpět ${vCas(d.posledni_zpet.odjezd)}.` : " V tento den se zpátky nedostanete.";
    return t;
  }

  function prvniJizda(s) { return (s.useky || []).find((u) => u.typ !== "pesky") || null; }
  /** [„Autobus“, ikona] pro úsek cesty. Vlaky ČD mají v datech někdy typ „bus“ – poznáme je podle druhu vlaku v čísle („Os 19814“, „R 608“). */
  function druh(u) {
    const typ = u && u.typ === "bus" && /^(Os|Sp|R|Rx|Ex|IC|EC|EN|RJ|LE|AEx|Rex|TL)\s*\d/.test(String(u.linka || "")) ? "vlak" : u && u.typ;
    return DRUHY[typ] || ["Spoj", "bus"];
  }

  function vykresliSpojeni(d, o) {
    const den = denZ(d.datum);
    const denText = denSlovy(den);
    const dnesni = jeDnes(den);
    const tam = d.tam || [];
    const se = Array.isArray(d.senior_expres) ? d.senior_expres : [];
    const dalsi = dalsiPracovniDen(den);
    const tlacitkoDen = (trida) => `<button type="button" class="tlacitko${trida}" data-akce="den" data-den="${D.isoDatum(dalsi)}">Zkusit ${esc(denSlovy(dalsi))}</button>`;
    const seText = "Odveze vás od domu až k lékaři a zpátky, i když spoj nejede. Jízdu objednáte předem telefonem.";
    const cilNazev = d.cil.nazev;

    if (!tam.length) {
      return `<div class="prazdny">
          <h3>${ikona("bus", "prazdny-ikona")}${dnesni ? "Dnes už sem spoj nejede" : "V tento den jsme spoj nenašli"}</h3>
          <p>Po ${esc(o.cas)} sem ${esc(denText)} žádný spoj nejede. Zkuste jiný den nebo dřívější čas odjezdu.</p>
          <div class="akce">${tlacitkoDen("")}</div>
        </div>${seniorExpres(se, seText, "se-spoj")}`;
    }

    if (d.jen_pesky) {
      return `<div class="blok info"><div><strong>Cíl je blízko. Dojdete pěšky za ${D.minuty(tam[0].minut)}.</strong>Zpátky dojdete také pěšky, spoj nepotřebujete.</div></div>
        <ol class="spoje">${kartaSpoje(tam[0], "tam-0", "tam", cilNazev)}</ol>`;
    }

    let html = "";
    const pz = d.posledni_zpet;
    const lzeZpet = d.zpet_mozne && pz;
    if (lzeZpet && se.length) html += seniorExpres(se, "Když se vám spoj nehodí, odveze vás od domu až k lékaři a zpátky. Objednává se předem telefonem.", "se-spoj");
    if (lzeZpet) {
      const j = prvniJizda(pz);
      html += `<div class="blok info posledni"><div>
        <strong>Poslední spoj zpět ${esc(denText)} ${vCas(pz.odjezd)}</strong>
        ${j && j.odjezd !== pz.odjezd ? `Od cíle vyjděte ${vCas(pz.odjezd)}, ${druh(j)[0].toLowerCase()} jede ${vCas(j.odjezd)} ze zastávky ${esc(veta(zastavka(j.z.nazev)))}`
              : j ? `${druh(j)[0]} jede ze zastávky ${esc(veta(zastavka(j.z.nazev)))}` : ""}
        Doma budete ${vCas(pz.prijezd)}.</div></div>`;
    } else {
      html += `<div class="blok chyba">${ikona("warning", "ikona")}<div>
        <strong>${dnesni ? "Dnes se už zpátky nedostanete" : "V tento den se zpátky nedostanete"}</strong>
        Po návštěvě už žádný spoj zpátky nejede. Zvolte jiný den${se.length ? ", nebo zavolejte službu níže" : ", nebo se domluvte na odvozu"}.</div></div>
        <div class="akce">${tlacitkoDen(" vedlejsi")}</div>
        ${seniorExpres(se, seText, "se-spoj")}`;
    }

    const tamAktivni = o.smer === "tam";
    const zpetKarty = (d.zpet || []).map((s, i) => kartaSpoje(s, `zpet-${i}`, "zpet", cilNazev)).join("");
    const posledniMeziZpet = pz && (d.zpet || []).some((s) => s.odjezd === pz.odjezd && s.prijezd === pz.prijezd);
    html += `
      <div class="zalozky" role="tablist" aria-label="Směr cesty">
        <button type="button" role="tab" id="zalozka-tam" aria-controls="panel-tam" aria-selected="${tamAktivni}" tabindex="${tamAktivni ? 0 : -1}">Tam</button>
        <button type="button" role="tab" id="zalozka-zpet" aria-controls="panel-zpet" aria-selected="${!tamAktivni}" tabindex="${tamAktivni ? -1 : 0}">Zpět</button>
      </div>
      <div role="tabpanel" id="panel-tam" class="panel" aria-labelledby="zalozka-tam" ${tamAktivni ? "" : "hidden"}>
        <p class="panel-uvod" tabindex="-1">Spoje ${esc(denText)} od ${esc(o.cas)} z vašeho bydliště.</p>
        <ol class="spoje">${tam.map((s, i) => kartaSpoje(s, `tam-${i}`, "tam", cilNazev)).join("")}</ol>
        <div class="akce"><button type="button" class="tlacitko vedlejsi" data-akce="pozdeji">Ukázat pozdější spoje</button></div>
      </div>
      <div role="tabpanel" id="panel-zpet" class="panel" aria-labelledby="zalozka-zpet" ${tamAktivni ? "hidden" : ""}>
        ${(d.zpet || []).length
          ? `<p class="panel-uvod" tabindex="-1">Zpáteční spoje od ${esc(d.zpet_od)}. Počítáme, že u cíle budete asi ${D.minuty(o.pobyt)}.</p>
             <ol class="spoje">${zpetKarty}</ol>
             ${pz && !posledniMeziZpet ? `<h3 class="nadpis-mensi">Poslední spoj zpět</h3><ol class="spoje">${kartaSpoje(pz, "zpet-posledni", "zpet", cilNazev)}</ol>` : ""}`
          : `<div class="blok chyba">${ikona("warning", "ikona")}<div><strong>${dnesni ? "Dnes se už zpátky nedostanete" : "V tento den se zpátky nedostanete"}</strong>Zvolte prosím jiný den.</div></div>`}
      </div>`;
    return html;
  }

  /** Jeden spoj jako řádek jízdního řádu: velký čas odjezdu, pak prostý text a rozbalitelná cesta. */
  function kartaSpoje(s, id, smer, cilNazev) {
    const prvni = prvniJizda(s);
    const pesky = (s.useky || []).filter((u) => u.typ === "pesky").reduce((a, u) => a + (u.minut || 0), 0);
    const odkud = smer === "tam" ? "z domu" : "od cíle";
    let veta, text;
    if (!prvni) {
      veta = `Pěšky ${D.minuty(s.minut)}, odchod ${s.odjezd}, příchod ${s.prijezd}.`;
      text = `<p class="spoj-hlavni">příchod <b>${esc(s.prijezd)}</b>, pěšky ${D.minuty(s.minut)}</p>
        <p class="spoj-udaje"><span>${ikona("person-simple-walk")}Pěšky, bez spoje</span></p>`;
    } else {
      const jizdy = s.useky.filter((u) => u.typ !== "pesky");
      const vyjit = s.odjezd !== prvni.odjezd ? `Vyjděte ${odkud} ${vCas(s.odjezd)}.` : "";
      veta = `Odjezd ${prvni.odjezd} ze zastávky ${zastavka(prvni.z.nazev)}, příjezd ${s.prijezd}, ${D.minuty(s.minut)}, ` +
        `${D.prestupy(s.prestupy)}${pesky ? `, ${pesky} min pěšky` : ""}.${vyjit ? " " + vyjit : ""}`;
      text = `<p class="spoj-hlavni">příjezd <b>${esc(s.prijezd)}</b>, celkem ${D.minuty(s.minut)}</p>
        <p>ze zastávky <b>${esc(zastavka(prvni.z.nazev))}</b></p>
        <p class="spoj-udaje">${jizdy.map((u) => `<span>${ikona(druh(u)[1])}${druh(u)[0]}${u.linka ? ` ${esc(u.linka)}` : ""}</span>`).join("")}<span>${ikona("arrows-left-right")}${D.prestupy(s.prestupy)}</span>${pesky ? `<span>${ikona("person-simple-walk")}${pesky} min pěšky</span>` : ""}</p>
        ${vyjit ? `<p class="male">${esc(vyjit)}</p>` : ""}`;
    }
    return `<li class="spoj" data-id="${id}">
      <span class="cas spoj-odjezd" aria-hidden="true">${esc(prvni ? prvni.odjezd : s.odjezd)}</span>
      <div class="spoj-text">
        <p class="sr">${esc(veta)}</p>
        <div aria-hidden="true">${text}</div>
        <div class="spoj-akce">
          <button type="button" class="odkaz-tlacitko" data-akce="cesta" aria-expanded="false" aria-controls="cesta-${id}">Ukázat cestu</button>
          <button type="button" class="odkaz-tlacitko" data-akce="poslat">Poslat blízkému</button>
          ${smer === "tam" ? `<button type="button" class="tlacitko vedlejsi tlacitko-sms" data-akce="sms" aria-expanded="false" aria-controls="sms-${id}">${ikona("chat-text")}Poslat SMS seniorovi</button>` : ""}
        </div>
        ${smer === "tam" ? `<div class="sms-panel" id="sms-${id}" hidden></div>` : ""}
        <p class="potvrzeni" role="status"></p>
      </div>
      <ol class="osa" id="cesta-${id}" hidden aria-label="Cesta krok za krokem">${osa(s, smer, id, cilNazev)}</ol>
    </li>`;
  }

  /** Časová osa: body (čas + místo) spojené čarou; pěšky tečkovaně. */
  function osa(s, smer, id, cilNazev) {
    const u = s.useky || [];
    const bod = (cas, misto, pozn = "") =>
      `<li class="osa-bod"><span class="osa-cas">${esc(cas || "")}</span><span class="osa-cara" aria-hidden="true"></span>` +
      `<div><b>${esc(misto)}</b>${pozn ? `<span class="osa-pozn">${esc(velke(pozn))}</span>` : ""}</div></li>`;
    const usek = (trida, obsah) =>
      `<li class="osa-usek ${trida}"><span class="osa-cas"></span><span class="osa-cara" aria-hidden="true"></span><div>${obsah}</div></li>`;
    const start = smer === "tam" ? "Domov" : cilNazev;
    const konec = smer === "tam" ? cilNazev : "Domov";
    const radky = [];
    if (u.length && u[0].typ === "pesky") radky.push(bod(s.odjezd, start, smer === "tam" ? "vyjděte z domu" : "vyjděte od cíle"));
    let predchozi = null, peskyMezi = 0;
    u.forEach((x, k) => {
      if (x.typ === "pesky") {
        peskyMezi += x.minut || 0;
        radky.push(usek("pesky", `${ikona("person-simple-walk")}${D.minuty(x.minut)} pěšky`));
        return;
      }
      let pozn = "nástup";
      if (predchozi) {
        const cekani = minutDne(x.odjezd) - minutDne(predchozi.prijezd) - peskyMezi;
        pozn = cekani > 0 ? `přestup, počkáte ${D.minuty(cekani)}` : "přestup";
      }
      predchozi = x; peskyMezi = 0;
      const [nazev, ik] = druh(x);
      const mz = x.mezizastavky || [];
      const mzId = `mz-${id}-${k}`;
      radky.push(bod(x.odjezd, zastavka(x.z && x.z.nazev), pozn));
      radky.push(usek("jizda", `<p>${ikona(ik)}<b>${nazev}${x.linka ? ` ${esc(x.linka)}` : ""}</b>${x.smer ? `, směr ${esc(zastavka(x.smer))}` : ""}</p>
        ${x.dopravce ? `<p class="male">${esc(x.dopravce)}</p>` : ""}
        ${mz.length ? `<button type="button" class="odkaz-tlacitko" data-akce="mezizastavky" aria-expanded="false" aria-controls="${mzId}">Zastávky po cestě (${mz.length})</button>
          <ol class="mezizastavky" id="${mzId}" hidden>${mz.map((z) => `<li><span class="osa-cas">${esc(z.cas)}</span><span>${esc(zastavka(z.nazev))}</span></li>`).join("")}</ol>` : ""}`));
      radky.push(bod(x.prijezd, zastavka(x.do && x.do.nazev), "výstup"));
    });
    if (u.length && u[u.length - 1].typ === "pesky") radky.push(bod(s.prijezd, konec, smer === "tam" ? "jste u cíle" : "jste doma"));
    return radky.join("");
  }

  function napojSpojeni(obsah, d, o) {
    // záložky Tam / Zpět (vzor ARIA tabs, šipky vlevo/vpravo)
    const zalozky = [...obsah.querySelectorAll("[role=tab]")];
    const prepni = (tab, fokus) => {
      zalozky.forEach((t) => {
        const ano = t === tab;
        t.setAttribute("aria-selected", String(ano));
        t.tabIndex = ano ? 0 : -1;
        el(t.getAttribute("aria-controls")).hidden = !ano;
      });
      if (fokus) tab.focus();
      const { krok, p } = ctiHash();
      const par = Object.fromEntries(p.entries());
      if (tab.id === "zalozka-zpet") par.smer = "zpet"; else delete par.smer;
      history.replaceState(null, "", hashZ(krok, par));
      stav.posledniHash = location.hash;
    };
    zalozky.forEach((t, i) => {
      t.addEventListener("click", () => prepni(t, false));
      t.addEventListener("keydown", (e) => {
        let j = null;
        if (e.key === "ArrowRight") j = (i + 1) % zalozky.length;
        else if (e.key === "ArrowLeft") j = (i - 1 + zalozky.length) % zalozky.length;
        else if (e.key === "Home") j = 0;
        else if (e.key === "End") j = zalozky.length - 1;
        if (j !== null) { e.preventDefault(); prepni(zalozky[j], true); }
      });
    });

    const spojKarty = (karta) => {
      const [smer, i] = karta.dataset.id.split("-");
      return smer === "tam" ? d.tam[+i] : i === "posledni" ? d.posledni_zpet : d.zpet[+i];
    };
    obsah.addEventListener("click", (e) => {
      const tl = e.target.closest("[data-akce]");
      if (!tl) return;
      const akce = tl.dataset.akce;
      if (akce === "cesta" || akce === "mezizastavky") {
        const otevrit = tl.getAttribute("aria-expanded") !== "true";
        tl.setAttribute("aria-expanded", String(otevrit));
        el(tl.getAttribute("aria-controls")).hidden = !otevrit;
        if (akce === "cesta") tl.textContent = otevrit ? "Skrýt cestu" : "Ukázat cestu";
      } else if (akce === "poslat") {
        const karta = tl.closest(".spoj");
        posliBlizkemu(textProBlizke(d, spojKarty(karta), karta.dataset.id.split("-")[0]), karta.querySelector(".potvrzeni"));
      } else if (akce === "sms") {
        const panel = el(tl.getAttribute("aria-controls"));
        const otevrit = tl.getAttribute("aria-expanded") !== "true";
        tl.setAttribute("aria-expanded", String(otevrit));
        panel.hidden = !otevrit;
        if (otevrit) otevriSms(panel, d, spojKarty(tl.closest(".spoj")), o);
        else { panel.innerHTML = ""; delete panel.dataset.kolo; }
      } else if (akce === "sms-poslat") {
        posliSms(tl.closest(".sms-panel"), d, spojKarty(tl.closest(".spoj")), o, tl);
      } else if (akce === "den") {
        zmen({ den: tl.dataset.den, cas: null });
      } else if (akce === "pozdeji") {
        const posledni = d.tam[d.tam.length - 1];
        const j = prvniJizda(posledni);
        const novy = casZMinut(minutDne(j ? j.odjezd : posledni.odjezd) + 1);
        const { p } = ctiHash();
        const par = Object.fromEntries(p.entries());
        par.cas = novy; delete par.smer;
        history.replaceState(null, "", hashZ("spojeni", par));
        stav.fokusPoNacteni = "#panel-tam .panel-uvod";
        vykresli({ fokus: "#spoj-obsah" });
      }
    });
    // jiný senior → SMS jde poslat znovu
    obsah.addEventListener("change", (e) => {
      const panel = e.target.closest(".sms-panel");
      if (!panel || e.target.type !== "radio") return;
      const tl = panel.querySelector("[data-akce=sms-poslat]");
      if (tl && panel.dataset.odeslano && panel.dataset.odeslano !== e.target.value) {
        tl.disabled = false;
        tl.innerHTML = `${ikona("paper-plane-right")}Poslat SMS`;
        panel.querySelector(".sms-nahled-obal").hidden = false;
        panel.querySelector(".sms-vysledek").innerHTML = "";
        delete panel.dataset.odeslano;
      }
    });
  }

  function textProBlizke(d, s, smer) {
    const den = velke(denSlovy(denZ(d.datum)));
    const c = d.cil;
    const j = prvniJizda(s);
    const radky = [];
    radky.push(smer === "tam" ? `Cesta: ${c.nazev}${c.obec ? ", " + c.obec : ""}` : `Cesta domů od: ${c.nazev}${c.obec ? ", " + c.obec : ""}`);
    if (j) {
      radky.push(`${den}: odjezd ${j.odjezd} ze zastávky ${zastavka(j.z.nazev)}, příjezd ${s.prijezd} (${D.minuty(s.minut)}, ${D.prestupy(s.prestupy)}).`);
      if (s.odjezd !== j.odjezd) radky.push(`Vyjít ${smer === "tam" ? "z domu" : "od cíle"} ${vCas(s.odjezd)}.`);
    } else {
      radky.push(`${den}: pěšky ${D.minuty(s.minut)}.`);
    }
    if (smer === "tam") {
      if (d.zpet_mozne && d.posledni_zpet) radky.push(`Poslední spoj zpět ${vCas(d.posledni_zpet.odjezd)}.`);
      else if (!d.jen_pesky) radky.push("Ten den se už zpátky nedostanete.");
    }
    radky.push("Vyhledáno na dojedeme.cz");
    return radky.join("\n");
  }

  async function posliBlizkemu(text, vystup) {
    const ukaz = (t) => { vystup.textContent = ""; setTimeout(() => { vystup.textContent = t; }, 60); };
    if (navigator.share) {
      try { await navigator.share({ title: "Spoj z Dojedeme", text }); ukaz("Spoj je odeslaný."); return; }
      catch (e) { if (e && e.name === "AbortError") return; }
    }
    try {
      await navigator.clipboard.writeText(text);
      ukaz("Text spoje je zkopírovaný. Vložte ho do zprávy nebo e-mailu.");
    } catch {
      const id = `text-${Math.random().toString(36).slice(2, 8)}`;
      vystup.innerHTML = `<label for="${id}">Označte text spoje a zkopírujte ho:</label><textarea id="${id}" class="text-ke-kopirovani" readonly rows="6">${esc(text)}</textarea>`;
      const ta = vystup.querySelector("textarea");
      ta.focus(); ta.select();
    }
  }

  // --- SMS seniorovi z účtu blízkého (pro-blizke.html / system) ------------------------------------
  /** Volání účtu: cookie relace jde sama (same-origin); chyba nese HTTP stav (401/403 = nepřihlášen, 404 = server to neumí). */
  async function volej(cesta, { metoda = "GET", telo = null } = {}) {
    const moznosti = { method: metoda, headers: {}, credentials: "same-origin", cache: "no-store" };
    if (telo !== null) { moznosti.body = JSON.stringify(telo); moznosti.headers["Content-Type"] = "application/json"; }
    let r;
    try { r = await fetch(cesta, moznosti); }
    catch { const e = new Error("Nepodařilo se spojit se serverem. Zkontrolujte připojení k internetu."); e.status = 0; throw e; }
    const data = (r.headers.get("content-type") || "").includes("json") ? await r.json().catch(() => null) : null;
    if (!r.ok) {
      const e = new Error((data && data.chyba) || "Server teď neodpovídá. Zkuste to prosím za chvíli.");
      e.status = r.status;
      throw e;
    }
    return data;
  }
  function jmenaSenioru() { const j = D.uloziste.cti(K_JMENA, {}); return j && typeof j === "object" && !Array.isArray(j) ? j : {}; }
  /** „+420 736 647 582“ (nezlomitelné mezery) */
  function cisloSeniora(t) { return ("+420 " + D.telefon(t)).replace(/ /g, "\u00a0"); }
  function jmenoSeniora(t, jmena) { return String(jmena[t] || "").trim() || cisloSeniora(t); }
  /** text SMS na obrazovce: šipka „->“ se nerozdělí na konci řádku */
  function smsNaObrazovce(t) { return String(t || "").replace(/->/g, "-\u2060>"); }
  function parametrySms(d, s, o) {
    const b = stav.bydliste;
    // čas = odchod z domu u vybraného spoje (HH:MM), aby SMS popisovala právě ten spoj
    return { z_lat: b.lat, z_lon: b.lon, cil_id: d.cil.id, datum: d.datum, cas: String(s.odjezd).padStart(5, "0"), pobyt: o.pobyt };
  }
  function chybaSms(e, nadpis) {
    let text = e.message, prihlasit = false;
    if (e.status === 401 || e.status === 403) { text = "Přihlášení vypršelo. Přihlaste se prosím znovu v systému."; prihlasit = true; }
    else if (e.status === 404) text = "Posílání spoje SMS teď na serveru nefunguje. Zkuste to prosím později.";
    return `<div class="blok chyba">${ikona("warning", "ikona")}<div><strong>${esc(nadpis)}</strong>${esc(text)}</div></div>` +
      (prihlasit ? `<p class="sms-akce"><a class="tlacitko vedlejsi" href="/system">Přejít do systému</a></p>` : "");
  }

  async function otevriSms(panel, d, s, o) {
    const kolo = `${Date.now()}-${Math.random()}`;
    panel.dataset.kolo = kolo;
    delete panel.dataset.odeslano;
    const platny = () => panel.dataset.kolo === kolo && !panel.hidden;
    const id = panel.id;
    const nadpis = `<h3 class="sms-nadpis">Poslat SMS seniorovi</h3>`;
    const doSystemu = `<p class="sms-akce"><a class="tlacitko vedlejsi" href="/system">Přejít do systému</a></p>`;
    panel.innerHTML = `${nadpis}<p class="male" role="status">Zjišťujeme, jestli jste přihlášení…</p>`;
    let ucet;
    try { ucet = await volej("/ucet"); }
    catch (e) { if (platny()) panel.innerHTML = nadpis + chybaSms(e, "Nepodařilo se zjistit, jestli jste přihlášení."); return; }
    if (!platny()) return;
    if (!ucet || !ucet.prihlasen) {
      panel.innerHTML = `${nadpis}<p>Spoj můžete poslat SMS seniorovi, kterého máte v systému.</p>${doSystemu}`;
      return;
    }
    const seniori = (Array.isArray(ucet.seniori) ? ucet.seniori : []).filter((x) => x && x.telefon);
    if (!seniori.length) {
      panel.innerHTML = `${nadpis}<p>V systému zatím nemáte žádného seniora. Přidejte ho a pak mu spoj pošlete jedním tlačítkem.</p>${doSystemu}`;
      return;
    }
    const jmena = jmenaSenioru();
    const prvni = seniori.find((x) => x.overeno);
    panel.innerHTML = `${nadpis}
      <fieldset class="sms-komu"><legend>Komu SMS poslat</legend>
        ${seniori.map((x, i) => {
          const rid = `${id}-s${i}`;
          const jmeno = String(jmena[x.telefon] || "").trim();
          return `<div class="volba-seniora${x.overeno ? "" : " ceka"}">
            <input type="radio" id="${rid}" name="${id}-komu" value="${esc(x.telefon)}"${x.overeno ? "" : ` disabled aria-describedby="${rid}-pozn"`}${x === prvni ? " checked" : ""}>
            <label for="${rid}"><span class="vs-jmeno">${esc(jmeno || cisloSeniora(x.telefon))}</span>${jmeno ? `<span class="vs-pozn">${esc(cisloSeniora(x.telefon))}</span>` : ""}${x.overeno ? "" : `<span class="vs-pozn" id="${rid}-pozn">Čeká na potvrzení čísla</span>`}</label>
          </div>`;
        }).join("")}
      </fieldset>
      ${prvni ? "" : `<p class="male">Senior musí nejdřív potvrdit své číslo SMS s kódem. Pak mu spoj půjde poslat.</p>`}
      <div class="sms-nahled-obal">
        <p class="sms-popisek" id="${id}-popisek">Text SMS</p>
        <div class="sms sms-nahled" id="${id}-text" aria-labelledby="${id}-popisek" role="group">Připravujeme text…</div>
        <p class="male sms-delka" id="${id}-delka"></p>
      </div>
      <p class="sms-akce"><button type="button" class="tlacitko" data-akce="sms-poslat"${prvni ? "" : " disabled"}>${ikona("paper-plane-right")}Poslat SMS</button></p>
      <div class="sms-vysledek" role="status"></div>`;
    try {
      const n = await D.api("/spojeni/sms", { parametry: parametrySms(d, s, o) });
      if (!platny()) return;
      el(`${id}-text`).textContent = smsNaObrazovce(n.text);
      el(`${id}-delka`).textContent = `${pocetZnaku(n.znaku)}, ${n.sms} SMS. Bez diakritiky, aby se zpráva přečetla na každém telefonu.`;
    } catch (e) {
      if (!platny()) return;
      el(`${id}-text`).textContent = "Náhled textu se teď nepodařilo připravit. SMS s tímto spojem půjde poslat i tak.";
    }
  }

  async function posliSms(panel, d, s, o, tl) {
    const vystup = panel.querySelector(".sms-vysledek");
    const vybrany = panel.querySelector("input[type=radio]:checked");
    if (!vybrany) {
      vystup.innerHTML = `<div class="blok chyba">${ikona("warning", "ikona")}<div><strong>Vyberte, komu SMS poslat.</strong></div></div>`;
      return;
    }
    const telefon = vybrany.value;
    const jmeno = jmenoSeniora(telefon, jmenaSenioru());
    tl.disabled = true;
    tl.innerHTML = `${ikona("paper-plane-right")}Posíláme SMS…`;
    vystup.innerHTML = "";
    try {
      const r = await volej("/ucet/poslat-spoj", { metoda: "POST", telo: { telefon, ...parametrySms(d, s, o) } });
      panel.dataset.odeslano = telefon;
      tl.innerHTML = `${ikona("check")}SMS je poslaná`;
      vystup.innerHTML = `<div class="blok uspech">${ikona("check-circle", "ikona")}<div><strong>SMS jsme poslali: ${esc(jmeno)}.</strong>${r && r.fronta ? "Odejde z telefonu služby během chvilky." : ""}</div></div>
        ${r && r.text ? `<p class="sms-popisek">Poslaný text</p><div class="sms odeslana">${esc(smsNaObrazovce(r.text))}</div>` : ""}`;
      if (r && r.text) panel.querySelector(".sms-nahled-obal").hidden = true;   // poslaný text je níže, náhled by se opakoval
    } catch (e) {
      tl.disabled = false;
      tl.innerHTML = `${ikona("paper-plane-right")}Poslat SMS`;
      vystup.innerHTML = chybaSms(e, "SMS se nepodařilo poslat.");
    }
  }

  // --- start --------------------------------------------------------------------------------------
  // zrušený jednoduchý režim: starou volbu smazat, ať nikdo nezůstane v nefunkčním stavu
  D.uloziste.smaz(K_ZRUSENY_REZIM);
  document.documentElement.classList.remove("jednoduchy");
  pripravFormular();
  vykresliOdkud();
  window.addEventListener("hashchange", () => {
    // odkaz „Přeskočit na obsah“ (#obsah) nemá měnit výsledek: vrátit adresu a nic nepřekreslovat
    const { krok } = ctiHash();
    if (krok && !["mista", "spojeni", "bydliste", "kam"].includes(krok) && document.getElementById(krok)) {
      history.replaceState(null, "", stav.posledniHash || location.pathname + location.search);
      return;
    }
    vykresli();
  });
  vykresli();
})();
