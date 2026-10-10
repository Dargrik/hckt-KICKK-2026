// Dojedeme – společné funkce webu (API + formátování podle design/BRAND.md, kap. 5 Texty).
// Použití: <script src="/static/js/dojedeme.js"></script> a pak window.Dojedeme.*

(function () {
  "use strict";

  /** Volání API na stejném serveru. Chyba API vyhodí Error se zprávou z pole `chyba` (pro člověka). */
  async function api(cesta, { parametry = null, metoda = "GET", telo = null, hlavicky = {} } = {}) {
    const url = new URL(cesta, window.location.origin);
    if (parametry) Object.entries(parametry).forEach(([k, v]) => v !== undefined && v !== null && v !== "" && url.searchParams.set(k, v));
    const moznosti = { method: metoda, headers: { ...hlavicky } };
    if (telo !== null) { moznosti.body = JSON.stringify(telo); moznosti.headers["Content-Type"] = "application/json"; }
    let odpoved;
    try { odpoved = await fetch(url, moznosti); }
    catch (e) { throw new Error("Nepodařilo se spojit se serverem. Zkontrolujte připojení k internetu."); }
    const typ = odpoved.headers.get("content-type") || "";
    const data = typ.includes("json") ? await odpoved.json() : await odpoved.text();
    if (!odpoved.ok) {
      if (odpoved.status === 403) throw new Error("K této akci nemáte oprávnění.");
      throw new Error((data && data.chyba) || "Server teď neodpovídá. Zkuste to prosím za chvíli.");
    }
    return data;
  }

  /** „+420736647582“ → „736 647 582“ (v textu); pro odkaz tel: použijte telefonOdkaz(). */
  function telefon(t) {
    const c = String(t || "").replace(/\s/g, "").replace(/^\+420/, "");
    return /^\d{9}$/.test(c) ? `${c.slice(0, 3)} ${c.slice(3, 6)} ${c.slice(6)}` : String(t || "");
  }
  function telefonOdkaz(t) { const c = String(t || "").replace(/\s/g, ""); return "tel:" + (c.startsWith("+") ? c : "+420" + c); }

  /** 0 → „bez přestupu“, 1 → „1 přestup“, 2–4 → „2 přestupy“, 5+ → „5 přestupů“ */
  function prestupy(n) { return n === 0 ? "bez přestupu" : n === 1 ? "1 přestup" : n < 5 ? `${n} přestupy` : `${n} přestupů`; }
  /** 1 spoj / 3 spoje / 9 spojů */
  function spoju(n) { return n === 1 ? "1 spoj" : n >= 2 && n <= 4 ? `${n} spoje` : `${n} spojů`; }
  /** 75 → „1 h 15 min“, 38 → „38 min“ */
  function minuty(m) {
    if (m === null || m === undefined || isNaN(m)) return "–";
    m = Math.round(m);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h` + (m % 60 ? ` ${m % 60} min` : "");
  }
  /** „2026-04-11“ → „11. 4. 2022“ */
  function datum(iso) { const [r, m, d] = String(iso).slice(0, 10).split("-").map(Number); return `${d}. ${m}. ${r}`; }
  /** Date → „2026-10-13“ (pro API) */
  function isoDatum(d) { const z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; }
  /** Date → „7:42“ (pro API i text) */
  function cas(d) { return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; }
  const DNY = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
  /** Date → „dnes“ / „zítra“ / „v pátek 16. 10.“ */
  function denSlovy(d) {
    const dnes = new Date(); dnes.setHours(0, 0, 0, 0);
    const x = new Date(d); x.setHours(0, 0, 0, 0);
    const rozdil = Math.round((x - dnes) / 864e5);
    if (rozdil === 0) return "dnes";
    if (rozdil === 1) return "zítra";
    const kdy = ["v neděli", "v pondělí", "v úterý", "ve středu", "ve čtvrtek", "v pátek", "v sobotu"][x.getDay()];
    return `${kdy} ${x.getDate()}. ${x.getMonth() + 1}.`;
  }
  /** Bezpečné vložení textu do HTML šablon. */
  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  /** Index barvy mapy (1–6, 0 = bez spojení) podle doby mimo domov v minutách (stejné hranice jako iOS). */
  function tridaMapy(min) {
    if (min === null || min === undefined || isNaN(min)) return 0;
    return min < 90 ? 1 : min < 120 ? 2 : min < 180 ? 3 : min < 240 ? 4 : min < 300 ? 5 : 6;
  }
  const LEGENDA_MAPY = ["bez spojení", "do 1,5 h", "1,5–2 h", "2–3 h", "3–4 h", "4–5 h", "5 h a víc"];

  /** Text upozornění u lékařů „nabírá“ – VŽDY zobrazit (BRAND.md). */
  const UPOZORNENI_2022 = "Údaj ze seznamu Karlovarského kraje z 11. 4. 2022 – před návštěvou zavolejte.";

  /** Otevírací doba z dat kraje → řádky [{dny: "Po–Pá", cas: "16:00–21:00"}, {dny: "So, Ne a svátky", …}], jinak null.
   *  Umí „po: 16:00-21:00; ut: …; svatek: …“ (pohotovosti), „PO+ST 8:00-17:00“ (matriky) a „nepřetržitě“. */
  const DNY_KLIC = ["po", "ut", "st", "ct", "pa", "so", "ne", "svatek"];
  const DNY_ZKR = { po: "Po", ut: "Út", st: "St", ct: "Čt", pa: "Pá", so: "So", ne: "Ne" };
  const bezDiakritiky = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const pomlcky = (s) => s.replace(/\s*-\s*/g, "–").replace(/,\s*/g, ", ");
  function popisDnu(dny) {
    const useky = [];
    for (const i of dny.filter((d) => d !== "svatek").map((d) => DNY_KLIC.indexOf(d))) {
      const u = useky[useky.length - 1];
      if (u && i === u[1] + 1) u[1] = i; else useky.push([i, i]);
    }
    const s = useky.map(([a, b]) => a === b ? DNY_ZKR[DNY_KLIC[a]]
      : b === a + 1 ? `${DNY_ZKR[DNY_KLIC[a]]}, ${DNY_ZKR[DNY_KLIC[b]]}` : `${DNY_ZKR[DNY_KLIC[a]]}–${DNY_ZKR[DNY_KLIC[b]]}`).join(", ");
    return dny.includes("svatek") ? (s ? `${s} a svátky` : "Svátky") : s;
  }
  function hodiny(text) {
    const t = String(text || "").trim();
    if (!t) return null;
    if (/^nepřetržitě$/i.test(t)) return [{ dny: "Každý den", cas: "nepřetržitě" }];
    const casti = t.split(";").map((x) => x.trim()).filter(Boolean);
    const casy = {};
    if (casti.every((c) => /^[a-zá-ž]+\s*:/i.test(c))) {          // „po: 16:00-21:00; …“
      for (const c of casti) {
        const [, den, cas] = c.match(/^([a-zá-ž]+)\s*:\s*(.+)$/i);
        const k = bezDiakritiky(den);
        if (!DNY_KLIC.includes(k)) return null;
        casy[k] = pomlcky(cas);
      }
      const skupiny = [];
      for (const d of DNY_KLIC) {
        if (!casy[d]) continue;
        let s = skupiny.find((x) => x.cas === casy[d]);
        if (!s) skupiny.push(s = { cas: casy[d], dny: [] });
        s.dny.push(d);
      }
      return skupiny.map((s) => ({ dny: popisDnu(s.dny), cas: s.cas }));
    }
    const m = t.match(/^([A-ZÁ-Ža-zá-ž+\-–]+)\s+(\d.*)$/);              // „PO+ST 8:00-17:00“, „PO-PÁ …“
    if (m) {
      const dny = [];
      for (const kus of m[1].split("+")) {
        const [a, b] = kus.split(/[-–]/).map(bezDiakritiky);
        const ia = DNY_KLIC.indexOf(a), ib = b ? DNY_KLIC.indexOf(b) : ia;
        if (ia < 0 || ib < 0) return null;
        for (let i = ia; i <= ib; i++) dny.push(DNY_KLIC[i]);
      }
      return [{ dny: popisDnu(dny), cas: pomlcky(m[2]) }];
    }
    return null;
  }

  /** Debounce pro našeptávače. */
  function zpozdeni(fn, ms = 300) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  /** Bezpečné localStorage (soukromé okno, zablokované úložiště). */
  const uloziste = {
    cti(k, vychozi = null) { try { const v = localStorage.getItem(k); return v === null ? vychozi : JSON.parse(v); } catch { return vychozi; } },
    zapis(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bez úložiště to jde i tak */ } },
    smaz(k) { try { localStorage.removeItem(k); } catch { /* nic */ } },
  };

  /** Web má jen světlý vzhled (vzhled.js). Funkce zůstává pro skripty, které se na vzhled ptají. */
  function vzhled() { return "light"; }

  /** Pravá část hlavičky: výrazné tlačítko „Přejít do systému“ (/system). Na stránce systému po přihlášení
   *  místo něj e-mail přihlášeného a Odhlásit se (ucetVHlavicce volá system.js). */
  function tlacitkoSystemu() {
    const sys = document.createElement("a");
    sys.className = "tlacitko-system";
    sys.href = "/system";
    sys.innerHTML = `<i class="ph-bold ph-user-circle" aria-hidden="true"></i><span class="dlouhy">Přejít do systému</span><span class="kratky" aria-hidden="true">Do systému</span>`;
    if (location.pathname.replace(/\/$/, "") === "/system") sys.setAttribute("aria-current", "page");
    return sys;
  }
  function pripravHlavicku() {
    const hlavicka = document.querySelector(".web-hlavicka .obal");
    if (!hlavicka || hlavicka.querySelector(".hlavicka-ucet")) return;
    const obal = document.createElement("div");
    obal.className = "hlavicka-ucet";
    obal.appendChild(tlacitkoSystemu());
    hlavicka.appendChild(obal);
  }
  /** Hlavička v systému pro blízké. email = přihlášený blízký: místo hlavní navigace webu navigace systému
   *  ([[href, text, aktivní]]) a vpravo menu účtu (Nastavení účtu, Odhlásit se).
   *  email = null vrátí hlavičku webu a tlačítko „Přejít do systému“. */
  let puvodniNav = null;
  function ucetVHlavicce(email, odhlasit, navigace = null) {
    pripravHlavicku();
    const hlava = document.querySelector(".web-hlavicka");
    const obal = hlava && hlava.querySelector(".hlavicka-ucet");
    if (!obal) return;
    const nav = hlava.querySelector(".web-nav");
    if (nav && puvodniNav === null) puvodniNav = nav.innerHTML;
    if (obal.dataset.email === (email || "") && obal.childElementCount) return;   // beze změny: nepřekreslovat (fokus, posluchače)
    obal.dataset.email = email || "";
    obal.innerHTML = "";
    hlava.classList.toggle("v-systemu", !!email);
    let stitek = hlava.querySelector(".znacka-system");
    if (!email) {
      obal.appendChild(tlacitkoSystemu());
      if (nav) { nav.innerHTML = puvodniNav; nav.setAttribute("aria-label", "Hlavní navigace"); }
      if (stitek) stitek.remove();
      return;
    }
    if (nav && navigace) {
      nav.innerHTML = navigace.map(([href, text, aktivni]) => `<a href="${esc(href)}"${aktivni ? ' aria-current="page"' : ""}>${esc(text)}</a>`).join("");
      nav.setAttribute("aria-label", "Navigace systému");
    }
    obal.innerHTML = `<div class="ucet-menu-obal">
        <button type="button" class="ucet-tlacitko" aria-haspopup="menu" aria-expanded="false" aria-controls="ucet-menu">
          <i class="ph-bold ph-user-circle" aria-hidden="true"></i><span class="sr">Účet: </span><span class="prihlaseny-email">${esc(email)}</span><i class="ph-bold ph-caret-down sipka" aria-hidden="true"></i></button>
        <ul class="menu ucet-menu" id="ucet-menu" role="menu" aria-label="Účet" hidden>
          <li role="none" class="ucet-menu-kdo">Přihlášeni jako <b>${esc(email)}</b></li>
          <li role="none"><a role="menuitem" tabindex="-1" href="#ucet"><i class="ph-bold ph-gear" aria-hidden="true"></i>Nastavení účtu</a></li>
          <li role="none" class="menu-oddelovac"><button type="button" role="menuitem" tabindex="-1" class="odhlasit"><i class="ph-bold ph-sign-out" aria-hidden="true"></i>Odhlásit se</button></li>
        </ul>
      </div>`;
    const tl = obal.querySelector(".ucet-tlacitko"), menu = obal.querySelector(".ucet-menu");
    const polozky = () => [...menu.querySelectorAll("[role=menuitem]")];
    const zavri = (fokus) => { menu.hidden = true; tl.setAttribute("aria-expanded", "false"); if (fokus) tl.focus(); };
    const otevri = (i = 0) => { menu.hidden = false; tl.setAttribute("aria-expanded", "true"); polozky().at(i).focus(); };
    tl.addEventListener("click", () => (menu.hidden ? otevri() : zavri(true)));
    tl.addEventListener("keydown", (e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); otevri(e.key === "ArrowUp" ? -1 : 0); } });
    menu.addEventListener("keydown", (e) => {
      const p = polozky(), i = p.indexOf(e.target);
      if (e.key === "ArrowDown") { e.preventDefault(); p[(i + 1) % p.length].focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); p[(i - 1 + p.length) % p.length].focus(); }
      else if (e.key === "Escape") { e.preventDefault(); zavri(true); }
      else if (e.key === "Tab") zavri(false);
    });
    menu.addEventListener("click", (e) => { if (e.target.closest("[role=menuitem]")) zavri(false); });
    document.addEventListener("click", (e) => { if (!menu.hidden && !obal.contains(e.target)) zavri(false); });
    obal.querySelector(".odhlasit").addEventListener("click", () => odhlasit());
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", pripravHlavicku);
  else pripravHlavicku();

  window.Dojedeme = { api, telefon, telefonOdkaz, prestupy, spoju, minuty, datum, isoDatum, cas, denSlovy, esc,
                      tridaMapy, LEGENDA_MAPY, UPOZORNENI_2022, zpozdeni, uloziste, hodiny, vzhled, ucetVHlavicce };
})();
