// Dojedeme – systém pro blízké (web/system.html, tlačítko „Přejít do systému“ v hlavičce): přihlášení a přehled seniorů,
// správa SMS služby přes účty blízkých (backend/API.md, „Účty blízkých (web)“). Popis služby je na /pro-blizke.
// Nepřihlášený: Přihlášení (nebo Nový účet, #registrace).
// Přihlášený: rovnou karty seniorů (dva sloupce) a pod nimi + Přidat seniora. Všechno ostatní je v okně (dialog #modal)
// nad přehledem a má vlastní adresu: #novy, #ucet a u seniora (menu ⋮ na kartě) #spoj, #predvolby, #terminy, #karticka,
// #upravit, #overeni s ?tel=. Zavření okna vrátí adresu na přehled. V hlavičce webu je e-mail a Odhlásit se.
// Relace je HttpOnly cookie, JS ji nevidí: stav zjišťujeme přes GET /ucet. Volání /sms/profil/{tel} autorizuje cookie,
// žádné X-Api-Token ani X-Profil-Klic. Číslo služby je soukromé: ukazuje se jen přihlášenému správci
// v kroku potvrzení a na kartičce (pole cislo_sluzby z /sms/profil…).
(function () {
  "use strict";
  const D = window.Dojedeme;
  const esc = D.esc;
  const K_JMENA = "dojedeme.blizci.jmena";   // {"+420…": "Děda Josef"}: jména jen v tomto prohlížeči
  const K_STARE = "dojedeme.seniori";        // stará verze stránky (bez účtů): převezmeme z ní jen jména
  const OBNOVA_MS = 5000;
  const TYPY = [
    ["praktik", "Praktický lékař", "praktik"], ["zubar", "Zubař", "zubar"], ["nemocnice", "Nemocnice", "nemocnice"],
    ["pohotovost", "Pohotovost", "pohotovost"], ["urad", "Úřad", "obecni_urad,matrika,urad_orp"],
    ["gynekolog", "Gynekolog", "gynekolog"], ["pediatr", "Dětský lékař", "pediatr"], ["ocni", "Oční lékař", "ocni"],
  ];

  const stav = {
    ucet: null,          // {prihlasen: true, email, seniori: […]} z GET /ucet, null = nepřihlášen
    zprava: null,        // jednorázová zpráva pro další pohled {typ, text}
    hlasit: null,        // text pro čtečku po vykreslení
    cisloSluzby: null,   // z odpovědí /sms/profil… (jen pro správce)
    kolo: 0,             // pořadí vykreslení: odpovědi starých pohledů se zahodí
    obnova: null, obnovaFn: null, obnovaMs: null,
    vykresleno: null,    // seznam seniorů, jak je právě vykreslený (JSON)
    dotazenoPro: null,   // hash, pro který se už účet obnovoval (hledaný senior chyběl)
    prvni: true,
  };
  const el = (id) => document.getElementById(id);
  const nacitani = el("nacitani"), verejne = el("verejne"), pohled = el("pohled");

  // --- pomocné funkce ------------------------------------------------------------------
  function ikona(nazev, trida = "") { return `<i class="ph-bold ph-${nazev}${trida ? " " + trida : ""}" aria-hidden="true"></i>`; }
  function velke(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }
  function hlas(text) { const h = el("hlaseni"); h.textContent = ""; setTimeout(() => { h.textContent = text; }, 80); }
  /** „736 647 582“, „+420736647582“, „00420 736…“ → „+420736647582“, jinak null */
  function normalizujTel(v) {
    let c = String(v || "").replace(/\D/g, "");
    if (c.length === 14 && c.startsWith("00420")) c = c.slice(5);
    else if (c.length === 12 && c.startsWith("420")) c = c.slice(3);
    return /^\d{9}$/.test(c) ? "+420" + c : null;
  }
  function telText(t) { return "+420 " + D.telefon(t).replace(/ /g, " "); }   // nezalomitelné mezery
  function cisloText(c) { const n = normalizujTel(c); return n ? telText(n) : String(c || ""); }
  function vCas(t) { const h = parseInt(t, 10); return ([2, 3, 4, 12, 13, 14, 20, 21, 22, 23].includes(h) ? "ve " : "v ") + t; }
  /** „2026-10-12T14:35:00“ → „12. 10. ve 14:35“ */
  function platnost(iso) {
    const d = new Date(iso);
    return isNaN(d) ? "" : `${d.getDate()}. ${d.getMonth() + 1}. ${vCas(D.cas(d))}`;
  }
  function pracovniDen() { const d = new Date(); d.setDate(d.getDate() + 1); while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1); return d; }
  /** 1 seniora / 2 seniory / 5 seniorů (4. pád) */
  function senioru(n) { return n === 1 ? "1 seniora" : n >= 2 && n <= 4 ? `${n} seniory` : `${n} seniorů`; }
  function ctiHash() {
    const h = location.hash.slice(1);
    const i = h.indexOf("?");
    return { krok: i < 0 ? h : h.slice(0, i), p: new URLSearchParams(i < 0 ? "" : h.slice(i + 1)) };
  }
  function hashZ(krok, parametry = {}) { const q = new URLSearchParams(parametry).toString(); return "#" + krok + (q ? "?" + q : ""); }
  /** Přechod na jiný pohled z kódu (odkazy <a href="#…"> jdou přes hashchange). */
  function jdiNa(hash) {
    if ((location.hash || "") !== (hash || "")) history.pushState(null, "", hash || location.pathname);
    vykresli();
  }
  function zaostri(prvek, kam = null) {
    if (!prvek) return;
    if (!prvek.matches("a, button, input, select, textarea, [tabindex]")) prvek.setAttribute("tabindex", "-1");
    if (kam === "nahoru") window.scrollTo(0, 0);
    else if (kam) prvek.scrollIntoView({ block: kam });
    prvek.focus({ preventScroll: !!kam });
  }
  function zpravaHtml() {
    const z = stav.zprava;
    stav.zprava = null;
    if (!z) return "";
    stav.hlasit = z.text;
    const ik = { chyba: "warning", uspech: "check-circle", info: "info" }[z.typ] || "info";
    return `<div class="blok ${z.typ} zprava">${ikona(ik, "ikona")}<div>${esc(z.text)}</div></div>`;
  }
  async function zkopiruj(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  }

  // --- jména seniorů (jen tento prohlížeč) ----------------------------------------------------
  function jmena() { const j = D.uloziste.cti(K_JMENA, {}); return j && typeof j === "object" && !Array.isArray(j) ? j : {}; }
  function jmeno(tel) { return String(jmena()[tel] || ""); }
  function ulozJmeno(tel, j) { const x = jmena(); if (j) x[tel] = j; else delete x[tel]; D.uloziste.zapis(K_JMENA, x); }
  function smazJmena(telefony) { const x = jmena(); telefony.forEach((t) => delete x[t]); D.uloziste.zapis(K_JMENA, x); }
  function nazevSeniora(tel) { return jmeno(tel) || telText(tel); }
  (function prevezmiStaraJmena() {
    const stare = D.uloziste.cti(K_STARE, null);
    if (!Array.isArray(stare)) return;
    const x = jmena();
    let zmena = false;
    stare.forEach((s) => { if (s && s.telefon && s.jmeno && !x[s.telefon]) { x[s.telefon] = s.jmeno; zmena = true; } });
    if (zmena) D.uloziste.zapis(K_JMENA, x);
  })();

  // --- volání API (cookie relace jde sama, same-origin) ------------------------------------------
  function lidskaChyba(chyba, status) {
    const c = String(chyba || "");
    if (status === 403) return "Přihlášení vypršelo. Přihlaste se prosím znovu.";
    if (/neexistuje/.test(c)) return "Tohoto seniora už služba nemá. Možná ho mezitím někdo smazal.";
    if (/telefon musí/.test(c)) return "Telefon musí mít 9 číslic, například 736 647 582.";
    if (/kódy zkratek/.test(c)) return "Čísla předvoleb musí být různá čísla od 1 do 999, například 11, 12, 13.";
    if (/cil_id/.test(c)) return "Některé místo už v našich datech není. Odeberte ho a vyberte znovu.";
    if (/souhlas/.test(c)) return "Bez souhlasu seniora službu nastavit nejde.";
    if (/bydliste/.test(c)) return "Vyberte prosím bydliště ze seznamu adres.";
    if (!c) return "Server teď neodpovídá. Zkuste to prosím za chvíli.";
    return /[.!?]$/.test(c) ? velke(c) : velke(c) + ".";
  }
  async function volej(cesta, { metoda = "GET", telo = null } = {}) {
    const moznosti = { method: metoda, headers: {}, credentials: "same-origin", cache: "no-store" };
    if (telo !== null) { moznosti.body = JSON.stringify(telo); moznosti.headers["Content-Type"] = "application/json"; }
    let r;
    try { r = await fetch(cesta, moznosti); }
    catch { const e = new Error("Nepodařilo se spojit se serverem. Zkontrolujte připojení k internetu."); e.status = 0; throw e; }
    const data = (r.headers.get("content-type") || "").includes("json") ? await r.json().catch(() => null) : null;
    if (!r.ok) {
      const e = new Error(lidskaChyba(data && data.chyba, r.status));
      e.status = r.status; e.chyba = (data && data.chyba) || "";
      throw e;
    }
    if (data && data.cislo_sluzby) stav.cisloSluzby = data.cislo_sluzby;
    return { status: r.status, data };
  }
  const cestaProfilu = (tel, dalsi = "") => `/sms/profil/${encodeURIComponent(tel)}${dalsi}`;
  async function nactiUcet() {
    const { data } = await volej("/ucet");
    stav.ucet = data && data.prihlasen ? data : null;
    return stav.ucet;
  }
  function senior(tel) { return (stav.ucet && (stav.ucet.seniori || []).find((s) => s.telefon === tel)) || null; }
  /** Relace skončila (403 nebo {prihlasen: false}) → zpět na přihlášení. */
  function poOdhlaseni(text, typ = "info") {
    stav.ucet = null;
    stav.zprava = { typ, text };
    zastavObnovu();
    if (location.hash) history.replaceState(null, "", location.pathname);
    vykresli();
  }
  function vyresOdhlaseni(e) {
    if (e && e.status === 403) { poOdhlaseni("Přihlášení vypršelo. Přihlaste se prosím znovu."); return true; }
    return false;
  }

  // --- pravidelná kontrola stavu (jen když je stránka vidět) ---------------------------------------
  function spustObnovu(fn, ms) {
    zastavObnovu();
    stav.obnovaFn = fn; stav.obnovaMs = ms;
    if (ms && document.visibilityState === "visible") stav.obnova = setInterval(fn, ms);
  }
  function zastavObnovu() {
    if (stav.obnova) clearInterval(stav.obnova);
    stav.obnova = null; stav.obnovaFn = null; stav.obnovaMs = null;
  }
  document.addEventListener("visibilitychange", () => {
    if (!stav.obnovaFn) return;
    if (document.visibilityState === "hidden") { clearInterval(stav.obnova); stav.obnova = null; }
    else if (!stav.obnova) { stav.obnovaFn(); if (stav.obnovaMs) stav.obnova = setInterval(stav.obnovaFn, stav.obnovaMs); }
  });

  // --- směrování ---------------------------------------------------------------------
  const OKNA_SENIORA = ["upravit", "overeni", "karticka", "terminy", "predvolby", "spoj"];
  function vykresli() {
    const { krok, p } = ctiHash();
    if (krok === "obsah") return;   // odkaz „Přeskočit na obsah“
    zastavObnovu();
    stav.kolo++;
    nacitani.hidden = true;
    ukazUcetVHlave();
    if (!stav.ucet) {
      zavriModal();
      const cil = ukazVerejne(krok === "registrace" ? "registrace" : "prihlaseni");
      if (!stav.prvni && cil) zaostri(cil, "nahoru");
      stav.prvni = false;
      if (stav.hlasit) { hlas(stav.hlasit); stav.hlasit = null; }
      return;
    }
    const tel = normalizujTel(p.get("tel"));
    const s = tel && senior(tel);
    const potrebujeSeniora = OKNA_SENIORA.includes(krok);
    if (potrebujeSeniora && !s && stav.dotazenoPro !== location.hash) {
      // senior mohl přibýt jinde (jiná karta): jednou obnovit účet, pak teprve hlásit, že tu není
      stav.dotazenoPro = location.hash;
      nactiUcet().catch((e) => { vyresOdhlaseni(e); }).then(() => { if (stav.dotazenoPro === location.hash) vykresli(); });
      return;
    }
    stav.dotazenoPro = null;
    if (potrebujeSeniora && !s) {
      stav.zprava = { typ: "chyba", text: "Tohoto seniora ve svém účtu nemáte." };
      history.replaceState(null, "", location.pathname);
    }
    // přehled (karty seniorů) je vidět vždy, okno se otevírá nad ním
    const okno = !potrebujeSeniora || s ? krok : "";
    const prehledH1 = ukazPrehled(!!okno);
    let cil = null;
    if (okno === "novy") cil = ukazFormular(null);
    else if (okno === "ucet") cil = ukazUcet();
    else if (okno === "upravit") cil = ukazFormular(s);
    else if (okno === "predvolby") cil = ukazFormular(s, "predvolby");
    else if (okno === "overeni") cil = ukazOvereni(s);
    else if (okno === "karticka") cil = ukazKarticku(s);
    else if (okno === "terminy") cil = ukazTerminy(s);
    else if (okno === "spoj") cil = ukazSpoj(s);
    else {
      if (krok) history.replaceState(null, "", location.pathname);   // #registrace apod. po přihlášení
      zavriModal();
    }
    if (cil) zaostri(cil);
    else if (stav.navrat) {   // po zavření okna fokus zpět na tlačítko, které ho otevřelo (menu karty, + Přidat seniora)
      const b = document.querySelector(`[data-fokus="${CSS.escape(stav.navrat)}"]`);
      stav.navrat = null;
      if (b) b.focus();
    } else if (!stav.prvni) zaostri(prehledH1, "nahoru");
    stav.prvni = false;
    if (stav.hlasit) { hlas(stav.hlasit); stav.hlasit = null; }
  }
  /** Hlavička webu: po přihlášení e-mail a Odhlásit se místo „Přejít do systému“; hlavička stránky jen pro nepřihlášené. */
  function ukazUcetVHlave() {
    const u = stav.ucet;
    D.ucetVHlavicce(u ? u.email || "" : null, odhlasit,
      [["#", "Senioři", true], ["#novy", "Přidat seniora", false], ["/aplikace", "Najít spoj", false]]);
    el("stranka-hlava").hidden = !!u;
  }
  /** Přehled přihlášeného (karty seniorů) do hlavní části stránky; vrací h1. */
  function ukazPohled(html, titulek) {
    verejne.hidden = true;
    pohled.hidden = false;
    pohled.innerHTML = html;
    document.title = `${titulek} – Systém pro blízké – Dojedeme`;
    return pohled.querySelector("h1, h2");
  }

  // --- okno (dialog) nad přehledem -------------------------------------------------------
  const modal = el("modal");
  /** Otevře okno s nadpisem, popisem (HTML) a obsahem; vrací nadpis (dostane fokus). */
  function ukazModal({ nadpis, popis = "", siroke = false }, obsah, titulek) {
    el("modal-nadpis").innerHTML = nadpis;
    el("modal-popis").innerHTML = popis;
    el("modal-popis").hidden = !popis;
    el("modal-obsah").innerHTML = obsah;
    modal.classList.toggle("siroke", siroke);
    document.title = `${titulek} – Systém pro blízké – Dojedeme`;
    if (!modal.open) {
      if (typeof modal.showModal === "function") modal.showModal(); else modal.setAttribute("open", "");
    }
    el("modal-obsah").scrollTop = 0;
    return el("modal-nadpis");
  }
  function zavriModal() {
    if (modal.open) { stav.zaviramModal = true; modal.close(); stav.zaviramModal = false; }
    el("modal-obsah").innerHTML = "";
  }
  /** Zavření křížkem, klávesou Esc nebo klepnutím vedle okna = návrat na přehled (adresa bez #…). */
  function zavritOknoUzivatelem() {
    if (location.hash && location.hash !== "#") history.pushState(null, "", location.pathname);
    vykresli();
  }
  el("modal-zavrit").addEventListener("click", zavritOknoUzivatelem);
  modal.addEventListener("cancel", (e) => { e.preventDefault(); zavritOknoUzivatelem(); });
  modal.addEventListener("click", (e) => { if (e.target === modal) zavritOknoUzivatelem(); });   // klepnutí na pozadí
  // --- chyby formulářů: souhrn v .blok.chyba s odkazy na pole -----------------------------------
  function vycistiChyby(koren, souhrnId) {
    koren.querySelectorAll("[aria-invalid]").forEach((x) => x.removeAttribute("aria-invalid"));
    koren.querySelectorAll(".pole-chyba").forEach((x) => { x.textContent = ""; });
    const s = el(souhrnId);
    if (s) { s.hidden = true; s.innerHTML = ""; }
  }
  /** Chyba u pole: aria-invalid + text pod polem; vrací položku do souhrnu. */
  function chybaPole(pole, text, uPole = true) {
    const p = el(pole);
    if (p) p.setAttribute("aria-invalid", "true");
    const t = el(pole + "-chyba");
    if (uPole && t) t.textContent = text;
    return { pole, text };
  }
  function ukazChyby(souhrnId, chyby, nadpis) {
    const box = el(souhrnId);
    box.hidden = false;
    box.innerHTML = `${ikona("warning", "ikona")}<div><strong>${esc(nadpis || (chyby.length > 1 ? "Opravte prosím tyto údaje:" : "Opravte prosím tento údaj:"))}</strong>
      <ul>${chyby.map((c) => `<li>${c.pole && el(c.pole) ? `<a href="#${esc(c.pole)}" data-pole="${esc(c.pole)}">${esc(c.text)}</a>` : esc(c.text)}${c.odkaz ? ` <a href="${esc(c.odkaz.href)}">${esc(c.odkaz.text)}</a>` : ""}</li>`).join("")}</ul></div>`;
    zaostri(box, "center");
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest(".souhrn-chyb [data-pole]");
    if (!a) return;
    e.preventDefault();
    const cil = el(a.dataset.pole);
    if (cil) { cil.scrollIntoView({ block: "center" }); cil.focus({ preventScroll: true }); }
  });

  // --- nepřihlášený: úvod, přihlášení, nový účet ---------------------------------------------------
  function ukazVerejne(rezim) {
    pohled.hidden = true;
    pohled.innerHTML = "";
    verejne.hidden = false;
    document.title = "Přihlášení – Systém pro blízké – Dojedeme";
    el("pristup-zprava").innerHTML = zpravaHtml();
    ["p-heslo", "r-heslo"].forEach((id) => { el(id).value = ""; });
    prepniRezim(rezim, false);
    return el("pristup-nadpis");
  }
  /** Oddíl Přihlášení: jeden nadpis (h2), pod ním formulář přihlášení nebo nového účtu. */
  function prepniRezim(rezim, fokus = true) {
    const registrace = rezim === "registrace";
    el("form-prihlaseni").hidden = registrace;
    el("form-registrace").hidden = !registrace;
    el("pristup-nadpis").textContent = registrace ? "Nový účet" : "Přihlášení";
    el("pristup-popis").textContent = registrace ? "Pod jedním účtem můžete nastavit službu pro více seniorů."
      : "Službu pro seniora nastavíte a upravíte po přihlášení.";
    vycistiChyby(el("pristup"), "pristup-chyby");
    const hash = registrace ? "#registrace" : "";
    if ((location.hash || "") !== hash) history.replaceState(null, "", hash || location.pathname);
    if (fokus) {
      el("pristup-zprava").innerHTML = "";
      zaostri(el("pristup-nadpis"), "nearest");
    }
  }
  el("pristup").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rezim]");
    if (b) prepniRezim(b.dataset.rezim);
  });
  document.querySelectorAll("[data-zobrazit]").forEach((z) => z.addEventListener("change", () => {
    z.dataset.zobrazit.split(" ").forEach((id) => { el(id).type = z.checked ? "text" : "password"; });
  }));
  el("pristup").addEventListener("input", (e) => {   // opravené pole už není chybné
    if (!e.target.id || e.target.type === "checkbox") return;
    e.target.removeAttribute("aria-invalid");
    const t = el(e.target.id + "-chyba");
    if (t) t.textContent = "";
  });
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  el("form-prihlaseni").addEventListener("submit", (e) => {
    e.preventDefault();
    vycistiChyby(el("pristup"), "pristup-chyby");
    const email = el("p-email").value.trim(), heslo = el("p-heslo").value;
    const chyby = [];
    if (!EMAIL_RE.test(email)) chyby.push(chybaPole("p-email", "Zadejte e-mail ve tvaru jmeno@domena.cz."));
    if (!heslo) chyby.push(chybaPole("p-heslo", "Zadejte heslo."));
    if (chyby.length) { ukazChyby("pristup-chyby", chyby); return; }
    odesliPristup(e.currentTarget, "/ucet/prihlaseni", { email, heslo }, false);
  });
  el("form-registrace").addEventListener("submit", (e) => {
    e.preventDefault();
    vycistiChyby(el("pristup"), "pristup-chyby");
    const email = el("r-email").value.trim(), heslo = el("r-heslo").value;
    const chyby = [];
    if (!EMAIL_RE.test(email)) chyby.push(chybaPole("r-email", "Zadejte e-mail ve tvaru jmeno@domena.cz."));
    if (!heslo) chyby.push(chybaPole("r-heslo", "Zadejte heslo."));
    if (chyby.length) { ukazChyby("pristup-chyby", chyby); return; }
    odesliPristup(e.currentTarget, "/ucet/registrace", { email, heslo }, true);
  });

  async function odesliPristup(form, cesta, telo, registrace) {
    const tl = form.querySelector("[type=submit]");
    const puvodni = tl.textContent;
    tl.disabled = true;
    tl.textContent = registrace ? "Zakládáme účet…" : "Přihlašujeme…";
    try {
      const { data } = await volej(cesta, { metoda: "POST", telo });
      stav.ucet = { prihlasen: true, ...data };
      if (registrace) stav.zprava = { typ: "uspech", text: "Hotovo, účet je založený a jste přihlášeni." };
      else stav.hlasit = "Jste přihlášeni.";
      vykresli();   // moji senioři (nebo pohled z odkazu, třeba #novy)
    } catch (e) {
      const c = e.chyba || "";
      const p = registrace ? "r" : "p";
      let pole = null;
      if (/e-mail/i.test(c) && !/heslo nesedí/i.test(c)) pole = `${p}-email`;
      else if (/heslo/i.test(c)) pole = `${p}-heslo`;
      const chyby = [pole ? chybaPole(pole, e.message) : { text: e.message }];
      ukazChyby("pristup-chyby", chyby, registrace ? "Účet se nepodařilo založit." : "Přihlášení se nepodařilo.");
    } finally {
      tl.disabled = false;
      tl.textContent = puvodni;
    }
  }

  // --- přihlášený: moji senioři ---------------------------------------------------------------
  function stavSeniora(s) {
    if (!s.overeno) return { trida: "ceka", ikona: "hourglass-medium", text: s.overeni ? "Čeká na potvrzení" : "Čeká na potvrzení, kód vypršel" };
    if (s.aktivni) return { trida: "zapnuto", ikona: "check-circle", text: "Zapnuto" };
    return { trida: "vypnuto", ikona: "pause-circle", text: "Vypnuto" };
  }
  function stavHtml(st) { return `<p class="stav ${st.trida}">${ikona(st.ikona)}<span>${esc(st.text)}</span></p>`; }

  function predvolbyHtml(zkratky) {
    if (!zkratky || !zkratky.length) return `<p class="male">Zatím žádné. Přidejte je v nastavení.</p>`;
    return `<ul class="predvolby">${zkratky.map((z) => {
      const popis = z.popis || z.nazev || "Uložené místo";
      const detail = z.nazev && z.nazev !== popis ? [z.nazev, z.obec].filter(Boolean).join(", ") : "";
      return `<li><span class="pv-kod">${esc(z.kod)}</span><span class="pv-text">${esc(popis)}${detail ? `<span class="pv-detail">${esc(detail)}</span>` : ""}</span></li>`;
    }).join("")}</ul>`;
  }

  /** Položky menu ⋮ na kartě seniora: [hash krok nebo null, ikona, text]. Každá otevře okno. */
  function polozkyMenu(s) {
    const p = [];
    if (!s.overeno) p.push(["overeni", "hourglass-medium", "Dokončit potvrzení čísla"]);
    p.push(["spoj", "paper-plane-tilt", "Poslat spoj"], ["predvolby", "list-numbers", "Upravit předvolby"],
      ["terminy", "calendar-check", "Termíny u lékaře"], ["karticka", "identification-card", "Kartička pro seniora"],
      ["upravit", "pencil-simple", "Upravit seniora"]);
    return p;
  }
  function seniorHtml(s, i) {
    const nazev = nazevSeniora(s.telefon);
    const jm = jmeno(s.telefon);
    const tel = s.telefon;
    let navic = "";
    if (!s.overeno && s.overeni) {
      navic = `<p class="senior-pozn">Senior pošle ze svého telefonu SMS s textem <b class="kod-text">${esc(s.overeni.sms || "*" + s.overeni.kod)}</b>. Kód platí do ${esc(platnost(s.overeni.plati_do))}.</p>`;
    } else if (!s.overeno) {
      navic = `<p class="senior-pozn">Kód pro potvrzení vypršel. Nový vytvoříte v menu pod „Dokončit potvrzení čísla“.</p>`;
    } else if (!s.aktivni) {
      navic = `<p class="senior-pozn">Senior poslal SMS s textem *STOP. Službu si znovu zapne SMS s textem *START.</p>`;
    }
    const menuId = `menu-${i}`;
    return `<li class="karta-seniora" data-tel="${esc(tel)}">
      <article aria-labelledby="senior-${i}">
        <div class="karta-hlava">
          <div class="karta-kdo">
            <h2 class="senior-jmeno" id="senior-${i}">${esc(nazev)}</h2>
            ${jm ? `<p class="senior-tel">${esc(telText(tel))}</p>` : ""}
          </div>
          <div class="menu-obal">
            <button type="button" class="menu-tlacitko" aria-haspopup="menu" aria-expanded="false" aria-controls="${menuId}"
              data-menu="${menuId}" data-fokus="menu|${esc(tel)}" title="Možnosti">${ikona("dots-three-vertical")}<span class="sr">Možnosti: ${esc(nazev)}</span></button>
            <ul class="menu" id="${menuId}" role="menu" aria-label="Možnosti: ${esc(nazev)}" hidden>
              ${polozkyMenu(s).map(([krok, ik, text]) => `<li role="none"><a role="menuitem" tabindex="-1" href="${hashZ(krok, { tel })}" data-navrat="menu|${esc(tel)}">${ikona(ik)}${esc(text)}</a></li>`).join("")}
              <li role="none" class="menu-oddelovac"><button type="button" role="menuitem" tabindex="-1" class="nebezpeci" data-smazat="${esc(tel)}" data-fokus="smazat|${esc(tel)}">${ikona("trash")}Smazat seniora</button></li>
            </ul>
          </div>
        </div>
        ${stavHtml(stavSeniora(s))}
        ${navic}
        <dl class="senior-udaje">
          <div><dt>Bydliště</dt><dd>${esc(s.bydliste_popis || "Uložené podle mapy")}</dd></div>
          <div><dt>Předvolby</dt><dd>${predvolbyHtml(s.zkratky)}</dd></div>
        </dl>
        <p class="karta-akce"><a class="tlacitko vedlejsi" href="${hashZ("spoj", { tel })}" data-fokus="spoj|${esc(tel)}" data-navrat="spoj|${esc(tel)}">${ikona("paper-plane-tilt")}Poslat spoj<span class="sr">: ${esc(nazev)}</span></a></p>
      </article>
    </li>`;
  }

  function seznamHtml() {
    const s = (stav.ucet && stav.ucet.seniori) || [];
    const pridat = `<div class="pridat-obal"><a class="pridat-seniora" href="#novy" data-fokus="novy" data-navrat="novy">
      <span class="plus" aria-hidden="true">${ikona("plus")}</span><span>Přidat seniora</span></a></div>`;
    if (!s.length) {
      return `<div class="prazdny-ucet">
        <p>Zatím tu nemáte žádného seniora. Přidejte ho: zadáte jeho číslo, bydliště a místa, kam jezdí. Senior pak jednou potvrdí číslo SMS kódem.</p>
      </div>${pridat}`;
    }
    return `<ul class="karty-senioru">${s.map(seniorHtml).join("")}</ul>${pridat}`;
  }

  function ukazPrehled(sOknem = false) {
    const u = stav.ucet;
    const h1 = ukazPohled(`<section class="oddil prehled-senioru" aria-labelledby="moji-nadpis"><div class="obal">
        <div class="prehled-hlava">
          <h1 id="moji-nadpis">Senioři</h1>
        </div>
        ${sOknem ? "" : zpravaHtml()}
        <div id="seznam-obal">${seznamHtml()}</div>
      </div></section>`, "Senioři");
    stav.vykresleno = JSON.stringify(u.seniori);
    // stav seniorů se obnovuje: každých 5 s, když některý čeká na potvrzení, jinak při návratu na stránku
    const moje = stav.kolo;
    spustObnovu(() => obnovPrehled(moje), cekaNekdo() ? OBNOVA_MS : null);
    return h1;
  }
  function cekaNekdo() { return ((stav.ucet && stav.ucet.seniori) || []).some((s) => !s.overeno); }

  async function obnovPrehled(moje) {
    const pred = (stav.ucet && stav.ucet.seniori) || [];
    try { await nactiUcet(); } catch (e) { if (moje === stav.kolo) vyresOdhlaseni(e); return; }
    if (moje !== stav.kolo) return;
    if (!stav.ucet) { poOdhlaseni("Přihlášení vypršelo. Přihlaste se prosím znovu."); return; }
    const ted = JSON.stringify(stav.ucet.seniori);
    if (ted === stav.vykresleno || el("dialog-smazat").open || otevreneMenu) return;   // otevřený dialog a menu nepřekreslovat
    stav.ucet.seniori.forEach((s) => {
      const p = pred.find((x) => x.telefon === s.telefon);
      if (p && !p.overeno && s.overeno) hlas(`${nazevSeniora(s.telefon)}: číslo je ověřené, služba je zapnutá.`);
    });
    prekresliSeznam();
    if (!cekaNekdo() && stav.obnova) { clearInterval(stav.obnova); stav.obnova = null; stav.obnovaMs = null; }
  }
  /** Překreslí seznam a vrátí fokus na stejný ovládací prvek (data-fokus). */
  function prekresliSeznam() {
    const obal = el("seznam-obal");
    if (!obal) return;
    const a = document.activeElement;
    const klic = a && obal.contains(a) ? a.getAttribute("data-fokus") : null;
    obal.innerHTML = seznamHtml();
    stav.vykresleno = JSON.stringify(stav.ucet.seniori);
    if (klic) { const b = obal.querySelector(`[data-fokus="${CSS.escape(klic)}"]`); if (b) b.focus({ preventScroll: true }); }
  }

  // --- menu ⋮ na kartě seniora (vzor menu button: šipky, Esc, klepnutí mimo) --------------------------
  let otevreneMenu = null;
  function zavriMenu(fokusNaTlacitko = false) {
    if (!otevreneMenu) return;
    const { tl, menu } = otevreneMenu;
    menu.hidden = true;
    tl.setAttribute("aria-expanded", "false");
    otevreneMenu = null;
    if (fokusNaTlacitko) tl.focus();
  }
  function otevriMenu(tl, prvni = 0) {
    zavriMenu();
    const menu = el(tl.getAttribute("aria-controls"));
    menu.hidden = false;
    tl.setAttribute("aria-expanded", "true");
    otevreneMenu = { tl, menu };
    const polozky = [...menu.querySelectorAll("[role=menuitem]")];
    (polozky.at(prvni) || polozky[0]).focus();
  }
  pohled.addEventListener("click", (e) => {
    const tl = e.target.closest("[data-menu]");
    if (tl) { if (otevreneMenu && otevreneMenu.tl === tl) zavriMenu(true); else otevriMenu(tl); return; }
    const navrat = e.target.closest("[data-navrat]");
    if (navrat) { stav.navrat = navrat.closest(".menu") ? `menu|${navrat.closest(".karta-seniora").dataset.tel}` : navrat.dataset.navrat; zavriMenu(); }
    const sm = e.target.closest("[data-smazat]");
    if (sm) { zavriMenu(); potvrdSmazani(sm.dataset.smazat, document.querySelector(`[data-fokus="menu|${CSS.escape(sm.dataset.smazat)}"]`) || sm); }
  });
  pohled.addEventListener("keydown", (e) => {
    const tl = e.target.closest("[data-menu]");
    if (tl && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); otevriMenu(tl, e.key === "ArrowUp" ? -1 : 0); return; }
    if (!otevreneMenu || !otevreneMenu.menu.contains(e.target)) return;
    const polozky = [...otevreneMenu.menu.querySelectorAll("[role=menuitem]")];
    const i = polozky.indexOf(e.target);
    if (e.key === "ArrowDown") { e.preventDefault(); polozky[(i + 1) % polozky.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); polozky[(i - 1 + polozky.length) % polozky.length].focus(); }
    else if (e.key === "Home") { e.preventDefault(); polozky[0].focus(); }
    else if (e.key === "End") { e.preventDefault(); polozky[polozky.length - 1].focus(); }
    else if (e.key === "Escape") { e.preventDefault(); zavriMenu(true); }
    else if (e.key === "Tab") zavriMenu();
    else if (e.key === " " && e.target.tagName === "A") { e.preventDefault(); e.target.click(); }
  });
  document.addEventListener("click", (e) => {
    if (otevreneMenu && !otevreneMenu.menu.contains(e.target) && !otevreneMenu.tl.contains(e.target)) zavriMenu();
  });

  // Odhlásit se: tlačítko je v hlavičce webu (dojedeme.js, ucetVHlavicce)
  async function odhlasit() {
    try { await volej("/ucet/odhlaseni", { metoda: "POST" }); }
    catch (e) { if (e.status !== 403) { hlas(`Odhlášení se nepodařilo. ${e.message}`); return; } }
    zavriModal();
    poOdhlaseni("Odhlásili jste se.", "uspech");
  }

  // --- účet: e-mail, odhlášení a smazání (okno #ucet) ------------------------------------------------
  function ukazUcet() {
    const u = stav.ucet;
    const seniori = u.seniori || [];
    const coSmazeme = [`váš účet ${u.email}`];
    if (seniori.length) coSmazeme.push(`${senioru(seniori.length)}: ${seniori.map((s) => nazevSeniora(s.telefon)).join(", ")}`,
      "jejich nastavení, předvolby, termíny u lékaře a historii SMS");
    const h = ukazModal({ nadpis: "Nastavení účtu" }, `
      <div class="ucet-blok">
        <h3>${ikona("user-circle")}Přihlašovací údaje</h3>
        <dl class="ucet-udaje">
          <div><dt>E-mail</dt><dd>${esc(u.email)}</dd></div>
          <div><dt>Senioři v účtu</dt><dd>${seniori.length}</dd></div>
        </dl>
      </div>
      <div class="ucet-blok">
        <h3>${ikona("key")}Změnit heslo</h3>
        <form id="form-heslo" class="ucet-form" novalidate>
          <input type="text" name="username" autocomplete="username" value="${esc(u.email)}" hidden>
          <div class="pole">
            <label for="zh-stare">Současné heslo</label>
            <input type="password" id="zh-stare" autocomplete="current-password" aria-describedby="zh-stare-chyba">
            <p class="pole-chyba" id="zh-stare-chyba"></p>
          </div>
          <div class="pole">
            <label for="zh-nove">Nové heslo</label>
            <input type="password" id="zh-nove" autocomplete="new-password" aria-describedby="zh-nove-chyba">
            <p class="pole-chyba" id="zh-nove-chyba"></p>
          </div>
          <div class="zaskrtavatko">
            <input type="checkbox" id="zh-zobrazit">
            <label for="zh-zobrazit">Zobrazit hesla</label>
          </div>
          <p><button type="submit" class="tlacitko">Změnit heslo</button></p>
          <p class="potvrzeni" id="zh-stav" role="status"></p>
        </form>
      </div>
      <div class="ucet-blok nebezpeci-blok">
        <h3>${ikona("trash")}Smazat účet</h3>
        <p>Smažeme natrvalo:</p>
        <ul class="smazeme">${coSmazeme.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
        ${seniori.length ? `<p>Seniorům pak služba přestane odpovídat na SMS. Chcete odebrat jen jednoho seniora? Použijte <b>Smazat seniora</b> v menu na jeho kartě.</p>` : ""}
        <form id="form-smazat-ucet" class="smazat-ucet-form" novalidate>
          <input type="text" name="username" autocomplete="username" value="${esc(u.email)}" hidden>
          <div class="zaskrtavatko">
            <input type="checkbox" id="su-rozumim" aria-describedby="su-rozumim-chyba">
            <label for="su-rozumim">Rozumím, že smazání nejde vrátit.</label>
          </div>
          <p class="pole-chyba" id="su-rozumim-chyba"></p>
          <div class="pole">
            <label for="su-heslo">Heslo k účtu</label>
            <input type="password" id="su-heslo" autocomplete="current-password" aria-describedby="su-heslo-chyba">
            <p class="pole-chyba" id="su-heslo-chyba" role="alert"></p>
          </div>
          <button type="submit" class="tlacitko nebezpeci">${ikona("trash")}Smazat účet natrvalo</button>
        </form>
      </div>`, "Nastavení účtu");
    el("zh-zobrazit").addEventListener("change", (e) => { ["zh-stare", "zh-nove"].forEach((id) => { el(id).type = e.target.checked ? "text" : "password"; }); });
    el("form-heslo").addEventListener("submit", zmenitHeslo);
    el("form-smazat-ucet").addEventListener("submit", smazatUcet);
    return h;
  }

  async function zmenitHeslo(e) {
    e.preventDefault();
    const stare = el("zh-stare"), nove = el("zh-nove");
    ["zh-stare", "zh-nove"].forEach((id) => { el(id).removeAttribute("aria-invalid"); el(id + "-chyba").textContent = ""; });
    const stavEl = el("zh-stav");
    stavEl.textContent = "";
    if (!stare.value) { chybaPole("zh-stare", "Zadejte současné heslo."); stare.focus(); return; }
    if (!nove.value) { chybaPole("zh-nove", "Zadejte nové heslo."); nove.focus(); return; }
    const tl = e.currentTarget.querySelector("[type=submit]");
    tl.disabled = true;
    try {
      await volej("/ucet/heslo", { metoda: "POST", telo: { heslo: stare.value, nove_heslo: nove.value } });
      stare.value = ""; nove.value = "";
      setTimeout(() => { stavEl.textContent = "Heslo je změněné. Na ostatních zařízeních jsme vás odhlásili."; }, 60);
    } catch (err) {
      if (vyresOdhlaseni(err)) return;
      const pole = /současné/i.test(err.chyba || "") ? "zh-stare" : "zh-nove";
      chybaPole(pole, err.message);
      el(pole).focus();
    } finally { tl.disabled = false; }
  }

  async function smazatUcet(e) {
    e.preventDefault();
    const pole = el("su-heslo"), chyba = el("su-heslo-chyba");
    const rozumim = el("su-rozumim"), chybaR = el("su-rozumim-chyba");
    chyba.textContent = ""; chybaR.textContent = "";
    pole.removeAttribute("aria-invalid"); rozumim.removeAttribute("aria-invalid");
    if (!rozumim.checked) { chybaR.textContent = "Potvrďte, že rozumíte, že smazání nejde vrátit."; rozumim.setAttribute("aria-invalid", "true"); rozumim.focus(); return; }
    if (!pole.value) { chyba.textContent = "Zadejte heslo k účtu."; pole.setAttribute("aria-invalid", "true"); pole.focus(); return; }
    const tl = e.currentTarget.querySelector("[type=submit]");
    tl.disabled = true;
    const telefony = ((stav.ucet && stav.ucet.seniori) || []).map((s) => s.telefon);
    try {
      const { data } = await volej("/ucet", { metoda: "DELETE", telo: { heslo: pole.value } });
      smazJmena(telefony);
      const n = data.smazane_profily || 0;
      zavriModal();
      poOdhlaseni(n ? `Účet je smazaný. Spolu s ním jsme smazali ${senioru(n)} a historii jejich SMS.` : "Účet je smazaný.", "uspech");
    } catch (err) {
      if (vyresOdhlaseni(err)) return;
      tl.disabled = false;
      chyba.textContent = err.message;
      pole.setAttribute("aria-invalid", "true");
      pole.focus();
    }
  }

  // --- smazání seniora (potvrzovací dialog) --------------------------------------------------------
  function potvrdSmazani(tel, spoust) {
    const dialog = el("dialog-smazat");
    const nazev = jmeno(tel);
    el("dialog-text").textContent = `Služba přestane odpovídat na SMS z čísla ${telText(tel)}${nazev ? ` (${nazev})` : ""}. Smaže se i jeho nastavení a historie SMS. Tohle nejde vrátit.`;
    el("dialog-chyba").textContent = "";
    const potvrdit = el("dialog-potvrdit"), zrusit = el("dialog-zrusit");
    let smazano = false;
    const naPotvrzeni = async () => {
      potvrdit.disabled = true;
      try {
        await volej(cestaProfilu(tel), { metoda: "DELETE" });
        smazano = true;
      } catch (e) {
        if (e.status === 403) { dialog.close(); vyresOdhlaseni(e); return; }
        if (/neexistuje/.test(e.chyba || "")) smazano = true;
        else { el("dialog-chyba").textContent = `Smazání se nepodařilo. ${e.message}`; potvrdit.disabled = false; return; }
      }
      ulozJmeno(tel, "");
      try { await nactiUcet(); } catch { if (stav.ucet) stav.ucet.seniori = stav.ucet.seniori.filter((s) => s.telefon !== tel); }
      potvrdit.disabled = false;
      stav.zprava = { typ: "uspech", text: `${nazev || telText(tel)}: služba je zrušená a údaje smazané.` };
      dialog.close();
      if (!stav.ucet) { poOdhlaseni("Přihlášení vypršelo. Přihlaste se prosím znovu."); return; }
      jdiNa("");
    };
    potvrdit.onclick = naPotvrzeni;
    zrusit.onclick = () => dialog.close();
    const klic = spoust.getAttribute("data-fokus");
    dialog.addEventListener("close", () => {
      if (smazano) return;
      const zpet = document.body.contains(spoust) ? spoust : document.querySelector(`[data-fokus="${CSS.escape(klic || "")}"]`);
      if (zpet) zpet.focus();
    }, { once: true });
    if (typeof dialog.showModal === "function") { dialog.showModal(); zrusit.focus(); }
    else if (window.confirm(el("dialog-text").textContent)) naPotvrzeni();
  }

  // --- nový kód pro potvrzení (jen když starý vypršel; ověřené číslo nový kód nedostane) ---------------
  async function novyKod(tel, tl, chybaEl) {
    tl.disabled = true;
    if (chybaEl) chybaEl.textContent = "";
    try {
      const { data } = await volej(cestaProfilu(tel, "/overeni"), { metoda: "POST" });
      const s = senior(tel);
      if (s) { s.overeni = data.overeni; s.overeno = false; }
      stav.hlasit = `Nový kód je ${data.overeni.sms}.`;
      jdiNa(hashZ("overeni", { tel }));
    } catch (e) {
      if (vyresOdhlaseni(e)) return;
      tl.disabled = false;
      if (/ověřené/.test(e.chyba || "")) { try { await nactiUcet(); } catch { /* nic */ } jdiNa(hashZ("overeni", { tel })); return; }
      if (chybaEl) chybaEl.textContent = e.message; else hlas(e.message);
    }
  }

  // --- našeptávač adres (vzor ARIA combobox, jako v aplikace.js) ------------------------------------
  function pocetAdres(n) { return n === 1 ? "1 adresa" : n >= 2 && n <= 4 ? `${n} adresy` : `${n} adres`; }
  function naseptavacAdres(koren, priVyberu) {
    const input = koren.querySelector("input");
    const seznam = koren.querySelector("[role=listbox]");
    const stavEl = koren.querySelector(".naseptavac-stav");
    let polozky = [], aktivni = -1, poradi = 0;
    function zavri() { seznam.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); aktivni = -1; }
    function otevri() { if (polozky.length) { seznam.hidden = false; input.setAttribute("aria-expanded", "true"); } }
    function nastavAktivni(i) {
      aktivni = i;
      [...seznam.children].forEach((li, j) => li.setAttribute("aria-selected", j === i ? "true" : "false"));
      if (i >= 0) { const li = seznam.children[i]; input.setAttribute("aria-activedescendant", li.id); li.scrollIntoView({ block: "nearest" }); }
      else input.removeAttribute("aria-activedescendant");
    }
    function vykresliSeznam() {
      seznam.innerHTML = polozky.map((a, i) => `<li role="option" id="${seznam.id}-${i}" aria-selected="false">${esc(a.adresa)}</li>`).join("");
      aktivni = -1;
      if (polozky.length) otevri(); else zavri();
    }
    function vyber(i) { const a = polozky[i]; if (!a) return; input.value = a.adresa; zavri(); stavEl.textContent = ""; priVyberu(a); }
    const hledej = D.zpozdeni(async () => {
      const q = input.value.trim();
      const moje = ++poradi;
      if (q.replace(/\s/g, "").length < 3) { polozky = []; vykresliSeznam(); stavEl.textContent = q ? "Napište aspoň 3 znaky." : ""; return; }
      try {
        const d = await D.api("/adresy", { parametry: { q, limit: 8 } });
        if (moje !== poradi) return;
        polozky = d.adresy || [];
        vykresliSeznam();
        if (!polozky.length) stavEl.textContent = "Takovou adresu nenacházíme. Zkontrolujte název obce nebo ulice a číslo domu.";
        else if (d.pocet > polozky.length) stavEl.textContent = `Našli jsme ${pocetAdres(d.pocet)}, ukazujeme prvních ${polozky.length}. Doplňte číslo domu.`;
        else stavEl.textContent = `${velke(pocetAdres(polozky.length))} v nabídce. Vyberte šipkami nebo klepnutím.`;
      } catch (e) {
        if (moje !== poradi) return;
        polozky = []; vykresliSeznam(); stavEl.textContent = e.message;
      }
    }, 300);
    input.addEventListener("input", () => { priVyberu(null); hledej(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { if (!polozky.length) return; e.preventDefault(); otevri(); nastavAktivni((aktivni + 1) % polozky.length); }
      else if (e.key === "ArrowUp") { if (!polozky.length) return; e.preventDefault(); otevri(); nastavAktivni(aktivni <= 0 ? polozky.length - 1 : aktivni - 1); }
      else if (e.key === "Enter") { if (!seznam.hidden && (aktivni >= 0 || polozky.length === 1)) { e.preventDefault(); vyber(Math.max(aktivni, 0)); } else if (!seznam.hidden) e.preventDefault(); }
      else if (e.key === "Escape") { if (!seznam.hidden) { e.preventDefault(); zavri(); } }
      else if (e.key === "Tab") zavri();
    });
    input.addEventListener("blur", () => setTimeout(zavri, 150));
    seznam.addEventListener("mousedown", (e) => e.preventDefault());
    seznam.addEventListener("click", (e) => { const li = e.target.closest("[role=option]"); if (li) vyber([...seznam.children].indexOf(li)); });
  }

  // --- formulář: přidat / upravit seniora ------------------------------------------------------
  /** Formulář v okně: nový senior (s = null), úprava celého záznamu, nebo rezim „predvolby“ (jen předvolby,
   *  bydliště a souhlas zůstávají, jak jsou). */
  function ukazFormular(s, rezim = s ? "upravit" : "novy") {
    const upravit = !!s;
    const jenPredvolby = rezim === "predvolby";
    const tel = s ? s.telefon : null;
    const f = {
      bydliste: s ? { lat: s.bydliste_lat, lon: s.bydliste_lon, popis: s.bydliste_popis || "" } : null,
      zkratky: s ? s.zkratky.map((z) => ({ kod: String(z.kod), cil_id: z.cil_id, popis: z.popis || "", cil: z.nazev ? { nazev: z.nazev, obec: z.obec } : null })) : [],
      jenPredvolby,
    };
    const skryt = jenPredvolby ? " hidden" : "";
    const h2 = ukazModal({
      nadpis: jenPredvolby ? "Předvolby" : upravit ? "Upravit seniora" : "Přidat seniora",
      popis: upravit ? kdoHtml(tel) : "Telefon, bydliště a místa, kam senior jezdí. Všechno jde později změnit.",
    }, `
      <div class="blok chyba souhrn-chyb" id="souhrn-chyb" tabindex="-1" hidden></div>
      <form id="formular" class="formular-sms${jenPredvolby ? " jen-predvolby" : ""}" novalidate>
        <fieldset class="krok-formulare"${skryt}>
          <legend><span class="krok-cislo">1.</span> Telefon seniora</legend>
          <div class="pole">
            <label for="f-telefon">Číslo mobilu seniora</label>
            <p class="napoveda-pole" id="f-telefon-napoveda">${upravit ? "Číslo změnit nejde. Pro jiné číslo přidejte nového seniora." : "Mobil, ze kterého bude psát. 9 číslic, například 736 647 582. Předvolbu +420 doplníme."}</p>
            <div class="telefon-pole"><span class="predvolba" aria-hidden="true">+420</span>
              <input type="tel" id="f-telefon" inputmode="tel" autocomplete="off" aria-describedby="f-telefon-napoveda f-telefon-chyba"
                ${upravit ? `value="${esc(D.telefon(tel))}" readonly` : ""}></div>
            <p class="pole-chyba" id="f-telefon-chyba"></p>
          </div>
          <div class="pole">
            <label for="f-jmeno">Jak mu říkáte <span class="nepovinne">(nepovinné)</span></label>
            <p class="napoveda-pole" id="f-jmeno-napoveda">Třeba Děda Josef. Jméno uvidíte jen vy v tomto prohlížeči, na server ho neposíláme.</p>
            <input type="text" id="f-jmeno" maxlength="40" autocomplete="off" aria-describedby="f-jmeno-napoveda" value="${esc(upravit ? jmeno(tel) : "")}">
          </div>
        </fieldset>

        <fieldset class="krok-formulare"${skryt}>
          <legend><span class="krok-cislo">2.</span> Bydliště</legend>
          <div class="naseptavac" id="nas-bydliste">
            <label for="adresa-b">Adresa, odkud senior jezdí</label>
            <p class="napoveda-pole" id="adresa-b-napoveda">Obec nebo ulice a číslo domu, například Abertamy 115. Pak adresu vyberte ze seznamu. Podle ní hledáme spoje tam i zpátky.</p>
            <input id="adresa-b" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="adresa-b-seznam"
                   aria-describedby="adresa-b-napoveda adresa-b-stav adresa-b-chyba" autocomplete="off" spellcheck="false" value="${esc(f.bydliste ? f.bydliste.popis : "")}">
            <ul id="adresa-b-seznam" role="listbox" aria-label="Nalezené adresy" hidden></ul>
            <p class="naseptavac-stav" id="adresa-b-stav" aria-live="polite"></p>
          </div>
          <p class="vybrane-bydliste" id="vybrane-bydliste" aria-live="polite"></p>
          <p class="pole-chyba" id="adresa-b-chyba"></p>
        </fieldset>

        <fieldset class="krok-formulare">
          <legend>${jenPredvolby ? "" : `<span class="krok-cislo">3.</span> `}Předvolby</legend>
          <p>Každé místo, kam senior jezdí, dostane číslo. Senior pak pošle SMS s hvězdičkou a tímto číslem, třeba <b>*11</b>. Číslo i popis přepíšete přímo v poli, číslo může být 1 až 999.</p>
          <ol class="zkratky" id="zkratky"></ol>
          <button type="button" class="tlacitko vedlejsi pridat-predvolbu" id="pridat-cil" aria-expanded="false" aria-controls="panel-cile" aria-describedby="pridat-cil-chyba">Přidat předvolbu</button>
          <p class="pole-chyba" id="pridat-cil-chyba"></p>
          <div class="panel-cile" id="panel-cile" hidden>
            <h3 id="panel-nadpis">Nová předvolba</h3>
            <fieldset class="typy"><legend>Co hledáte?</legend>
              <div class="typy-radek">${TYPY.map(([k, n]) => `<button type="button" class="typ" data-typ="${k}" aria-pressed="false">${esc(n)}</button>`).join("")}</div>
            </fieldset>
            <div class="hledat-cil">
              <label for="hledat-cil">Nebo hledejte podle jména, adresy nebo obce</label>
              <div class="pole-s-tlacitkem">
                <input type="search" id="hledat-cil" autocomplete="off" aria-describedby="hledat-cil-napoveda">
                <button type="button" class="tlacitko vedlejsi" id="hledat-cil-tlacitko">Hledat</button>
              </div>
              <p class="napoveda-pole" id="hledat-cil-napoveda">Například Jedelský nebo Nejdek. Diakritiku psát nemusíte.</p>
            </div>
            <div id="vysledky-cile" class="vysledky-cile" aria-live="polite"></div>
            <button type="button" class="odkaz-tlacitko" id="zavrit-panel">Zavřít bez přidání</button>
          </div>
        </fieldset>

        <fieldset class="krok-formulare"${skryt}>
          <legend><span class="krok-cislo">4.</span> Souhlas seniora</legend>
          <div class="zaskrtavatko souhlas">
            <input type="checkbox" id="f-souhlas" aria-describedby="f-souhlas-chyba" ${upravit ? "checked" : ""}>
            <label for="f-souhlas">Senior souhlasí s tím, že Dojedeme uloží jeho telefonní číslo a bydliště, aby mu mohlo posílat spoje. Souhlas může kdykoli zrušit SMS s textem STOP.</label>
          </div>
          <p class="pole-chyba" id="f-souhlas-chyba"></p>
        </fieldset>

        <div class="odeslat akce">
          <button type="submit" class="tlacitko velke" id="f-ulozit">${jenPredvolby ? "Uložit předvolby" : upravit ? "Uložit změny" : "Uložit a získat kód"}</button>
          <a href="#" class="odkaz-akce">Zrušit</a>
        </div>
      </form>`, jenPredvolby ? `Předvolby: ${nazevSeniora(tel)}` : upravit ? `Upravit seniora: ${nazevSeniora(tel)}` : "Přidat seniora");

    // telefon: po opuštění pole formát 736 647 582
    const telPole = el("f-telefon");
    if (!upravit) telPole.addEventListener("blur", () => { const n = normalizujTel(telPole.value); if (n) telPole.value = D.telefon(n); });
    telPole.addEventListener("input", () => { telPole.removeAttribute("aria-invalid"); el("f-telefon-chyba").textContent = ""; });

    // bydliště
    const vybrane = el("vybrane-bydliste");
    const ukazBydliste = () => { vybrane.innerHTML = f.bydliste ? `Vybráno: <b>${esc(f.bydliste.popis || "místo na mapě")}</b>` : ""; };
    ukazBydliste();
    naseptavacAdres(el("nas-bydliste"), (a) => {
      f.bydliste = a ? { lat: a.lat, lon: a.lon, popis: a.adresa } : null;
      ukazBydliste();
      if (a) { el("adresa-b-chyba").textContent = ""; el("adresa-b").removeAttribute("aria-invalid"); }
    });

    // předvolby
    const zkratkyEl = el("zkratky"), pridat = el("pridat-cil"), panel = el("panel-cile"), vysledky = el("vysledky-cile");
    function vykresliZkratky() {
      zkratkyEl.innerHTML = f.zkratky.map((z, i) => `
        <li class="zkratka" data-i="${i}">
          <div class="zk-kod">
            <label for="zk-kod-${i}">Číslo v SMS</label>
            <div class="zk-kod-pole"><span aria-hidden="true">*</span><input type="text" id="zk-kod-${i}" inputmode="numeric" maxlength="3" value="${esc(z.kod)}" data-pole="kod" aria-describedby="zk-kod-${i}-chyba"></div>
          </div>
          <div class="zk-cil">
            <p class="zk-nazev"><b>${esc(z.cil ? z.cil.nazev : z.popis || "Uložené místo")}</b></p>
            ${z.cil && (z.cil.typ_nazev || z.cil.obec) ? `<p class="male">${esc([z.cil.typ_nazev, z.cil.adresa || z.cil.obec].filter(Boolean).join(", "))}</p>` : ""}
            ${z.cil && z.cil.nabira ? `<p class="odznaky"><span class="odznak nabira">${ikona("check-circle")}Přijímá nové pacienty</span></p>` : ""}
            <label for="zk-popis-${i}">Popis na kartičce a v SMS</label>
            <input type="text" id="zk-popis-${i}" maxlength="40" value="${esc(z.popis)}" data-pole="popis">
          </div>
          <button type="button" class="zk-odebrat" data-odebrat="${i}" title="Odebrat předvolbu">${ikona("trash")}<span class="sr">Odebrat předvolbu ${esc(z.kod)}, ${esc(z.popis || (z.cil && z.cil.nazev) || "")}</span></button>
          <p class="pole-chyba zk-chyba" id="zk-kod-${i}-chyba"></p>
        </li>`).join("");
      pridat.innerHTML = `${ikona("plus")}${f.zkratky.length ? "Přidat další předvolbu" : "Přidat předvolbu"}`;
    }
    vykresliZkratky();
    zkratkyEl.addEventListener("input", (e) => {
      const li = e.target.closest(".zkratka");
      if (!li) return;
      const z = f.zkratky[+li.dataset.i];
      if (e.target.dataset.pole === "kod") {
        e.target.value = e.target.value.replace(/\D/g, "");
        z.kod = e.target.value;
        e.target.removeAttribute("aria-invalid");
        const ch = el(e.target.id + "-chyba"); if (ch) ch.textContent = "";
      }
      if (e.target.dataset.pole === "popis") z.popis = e.target.value;
    });
    zkratkyEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-odebrat]");
      if (!b) return;
      const [z] = f.zkratky.splice(+b.dataset.odebrat, 1);
      vykresliZkratky();
      pridat.focus();
      hlas(`Předvolba ${z.kod} je odebraná.`);
    });

    function dalsiKod() {
      const kody = f.zkratky.map((z) => parseInt(z.kod, 10)).filter((n) => n > 0);
      let k = Math.max(10, ...kody) + 1;
      while (kody.includes(k)) k++;
      return k > 999 ? "" : String(k);
    }
    function zavriPanel(fokus = true) {
      panel.hidden = true;
      pridat.setAttribute("aria-expanded", "false");
      vysledky.innerHTML = "";
      panel.querySelectorAll(".typ").forEach((t) => t.setAttribute("aria-pressed", "false"));
      el("hledat-cil").value = "";
      if (fokus) pridat.focus();
    }
    pridat.addEventListener("click", () => {
      if (!panel.hidden) { zavriPanel(); return; }
      if (!f.bydliste) {
        el("adresa-b-chyba").textContent = "Nejdřív vyberte bydliště. Podle něj seřadíme místa podle spojení.";
        el("adresa-b").setAttribute("aria-invalid", "true");
        el("adresa-b").focus();
        return;
      }
      el("pridat-cil-chyba").textContent = "";
      pridat.removeAttribute("aria-invalid");
      panel.hidden = false;
      pridat.setAttribute("aria-expanded", "true");
      panel.querySelector(".typ").focus();
    });
    el("zavrit-panel").addEventListener("click", () => zavriPanel());
    panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); zavriPanel(); } });
    panel.querySelectorAll(".typ").forEach((t) => t.addEventListener("click", () => {
      panel.querySelectorAll(".typ").forEach((x) => x.setAttribute("aria-pressed", String(x === t)));
      const typ = TYPY.find(([k]) => k === t.dataset.typ);
      nactiCile({ typ: typ[2], nadpis: typ[1] });
    }));
    const hledatCil = () => {
      const q = el("hledat-cil").value.trim();
      if (q.replace(/\s/g, "").length < 2) { vysledky.innerHTML = `<p class="pole-chyba">Napište aspoň 2 písmena jména, adresy nebo obce.</p>`; return; }
      panel.querySelectorAll(".typ").forEach((x) => x.setAttribute("aria-pressed", "false"));
      nactiCile({ q, nadpis: `Hledání: ${q}` });
    };
    el("hledat-cil-tlacitko").addEventListener("click", hledatCil);
    el("hledat-cil").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); hledatCil(); } });

    let nalezene = [];
    let poradiCilu = 0;
    async function nactiCile({ typ, q, nadpis }) {
      const moje = ++poradiCilu;
      vysledky.setAttribute("aria-busy", "true");
      vysledky.innerHTML = `<p class="male">Hledáme a řadíme podle spojení…</p>`;
      try {
        const d = await D.api("/cile", { parametry: { typ, q, lat: f.bydliste.lat, lon: f.bydliste.lon, datum: D.isoDatum(pracovniDen()), cas: "07:00", limit: 10 } });
        if (moje !== poradiCilu) return;
        nalezene = d.cile || [];
        vysledky.removeAttribute("aria-busy");
        if (!nalezene.length) { vysledky.innerHTML = `<p>Nic jsme nenašli. Zkuste jiný druh místa nebo jiné slovo.</p>`; return; }
        vysledky.innerHTML = `
          <h4 class="vc-nadpis">${esc(nadpis)}</h4>
          <p class="male">Seřazeno podle spojení z bydliště seniora v pracovní den od 7:00, ne podle vzdálenosti.</p>
          <ol class="vyber-cilu">${nalezene.map((c, i) => {
            const uz = f.zkratky.find((z) => z.cil_id === c.id);
            const spoj = c.dostupne === false || !c.odjezd
              ? `<p class="vc-spoj">V tento den se tam spojem nedostane.</p>`
              : `<p class="vc-spoj">${ikona("bus")}<span>Odjezd ${esc(c.odjezd)}, cesta ${D.minuty(c.cesta_min)}, ${D.prestupy(c.prestupy)}</span></p>`;
            return `<li>
              <p class="vc-nazev"><b>${esc(c.nazev)}</b></p>
              <p class="male">${esc([c.typ_nazev, c.adresa || c.obec].filter(Boolean).join(", "))}</p>
              ${spoj}
              ${c.nabira ? `<p class="odznaky"><span class="odznak nabira">${ikona("check-circle")}Přijímá nové pacienty</span></p>` : ""}
              ${uz ? `<p class="male">Už je v předvolbách pod číslem ${esc(uz.kod)}.</p>`
                : `<button type="button" class="tlacitko vedlejsi" data-pridat="${i}">Přidat jako ${dalsiKod()}<span class="sr">: ${esc(c.nazev)}</span></button>`}
            </li>`;
          }).join("")}</ol>`;
      } catch (e) {
        if (moje !== poradiCilu) return;
        vysledky.removeAttribute("aria-busy");
        vysledky.innerHTML = `<div class="blok chyba">${ikona("warning", "ikona")}<div><strong>Místa se nepodařilo načíst.</strong>${esc(e.message)}</div></div>`;
      }
    }
    vysledky.addEventListener("click", (e) => {
      const b = e.target.closest("[data-pridat]");
      if (!b) return;
      const c = nalezene[+b.dataset.pridat];
      const kod = dalsiKod();
      const popis = `${c.typ_nazev || c.nazev}${c.obec ? " " + c.obec : ""}`.slice(0, 40);
      f.zkratky.push({ kod, cil_id: c.id, popis, cil: { nazev: c.nazev, obec: c.obec, adresa: c.adresa, typ_nazev: c.typ_nazev, nabira: !!c.nabira } });
      vykresliZkratky();
      zavriPanel();
      el("pridat-cil-chyba").textContent = "";
      pridat.removeAttribute("aria-invalid");
      hlas(`Přidáno: předvolba ${kod}, ${popis}.`);
    });

    el("formular").addEventListener("submit", (e) => { e.preventDefault(); odesli(s, f); });
    return h2;
  }

  function validuj(s, f) {
    const formular = el("formular");
    vycistiChyby(formular, "souhrn-chyb");
    const chyby = [];
    if (!s) {
      const tel = normalizujTel(el("f-telefon").value);
      if (!tel) chyby.push(chybaPole("f-telefon", "Telefon musí mít 9 číslic, například 736 647 582."));
      else if (senior(tel)) {
        const c = chybaPole("f-telefon", `Číslo ${telText(tel)} už ve svém přehledu máte.`);
        c.odkaz = { href: hashZ("upravit", { tel }), text: "Upravit tohoto seniora" };
        chyby.push(c);
      }
    }
    if (!f.bydliste) chyby.push(chybaPole("adresa-b", "Vyberte bydliště ze seznamu adres."));
    if (!f.zkratky.length) chyby.push(chybaPole("pridat-cil", "Přidejte aspoň jednu předvolbu, třeba nemocnici nebo praktického lékaře."));
    const videne = {};
    f.zkratky.forEach((z, i) => {
      const nazev = z.popis || (z.cil && z.cil.nazev) || `${i + 1}. předvolba`;
      if (!/^[1-9]\d{0,2}$/.test(z.kod)) chyby.push(chybaPole(`zk-kod-${i}`, `Číslo u „${nazev}“ musí být od 1 do 999.`));
      else if (videne[z.kod]) chyby.push(chybaPole(`zk-kod-${i}`, `Číslo ${z.kod} je v předvolbách dvakrát. Každé místo potřebuje jiné číslo.`));
      videne[z.kod] = true;
    });
    if (!el("f-souhlas").checked) chyby.push(chybaPole("f-souhlas", "Bez souhlasu seniora službu nastavit nejde."));
    return chyby;
  }

  async function odesli(s, f) {
    const upravit = !!s;
    const chyby = validuj(s, f);
    if (chyby.length) { ukazChyby("souhrn-chyb", chyby); return; }
    const tel = upravit ? s.telefon : normalizujTel(el("f-telefon").value);
    const jmenoText = el("f-jmeno") ? el("f-jmeno").value.trim() : jmeno(tel);
    const tl = el("f-ulozit");
    const puvodni = tl.textContent;
    tl.disabled = true;
    tl.textContent = "Ukládáme…";
    const telo = {
      bydliste: { lat: f.bydliste.lat, lon: f.bydliste.lon, popis: f.bydliste.popis },
      zkratky: f.zkratky.map((z) => ({ kod: z.kod, cil_id: z.cil_id, popis: z.popis.trim() || null })),
      souhlas: true,
    };
    try {
      const { status } = await volej(cestaProfilu(tel), { metoda: "PUT", telo });
      ulozJmeno(tel, jmenoText);
      try { await nactiUcet(); } catch { /* přehled si stav načte znovu */ }
      if (!stav.ucet) { poOdhlaseni("Přihlášení vypršelo. Přihlaste se prosím znovu."); return; }
      if (status === 201) {
        jdiNa(hashZ("overeni", { tel }));
      } else {
        stav.zprava = { typ: "uspech", text: `${jmenoText || telText(tel)}: ${f.jenPredvolby ? "předvolby jsou uložené" : "změny jsou uložené"} a platí hned.` };
        jdiNa("");
      }
    } catch (e) {
      tl.disabled = false;
      tl.textContent = puvodni;
      if (vyresOdhlaseni(e)) return;
      const c = e.chyba || "";
      let pole = null;
      if (/někdo jiný|telefon/.test(c)) pole = upravit ? null : "f-telefon";
      else if (/kódy zkratek/.test(c)) pole = f.zkratky.length ? "zk-kod-0" : null;
      else if (/cil_id/.test(c)) pole = "pridat-cil";
      else if (/souhlas/.test(c)) pole = "f-souhlas";
      else if (/bydliste/.test(c)) pole = "adresa-b";
      ukazChyby("souhrn-chyb", [pole ? chybaPole(pole, e.message) : { text: e.message }],
        upravit ? "Změny se nepodařilo uložit." : "Seniora se nepodařilo přidat.");
    }
  }

  // --- potvrzení čísla kódem ------------------------------------------------------------------
  function kdoHtml(tel) { return esc(nazevSeniora(tel)) + (jmeno(tel) ? `, ${esc(telText(tel))}` : ""); }

  function ukazOvereni(s) {
    const tel = s.telefon;
    const h2 = ukazModal({ nadpis: "Potvrzení čísla", popis: kdoHtml(tel) }, `
      <div id="overeni-obsah" aria-busy="true"><div class="skeleton" style="height:240px"></div></div>`, "Potvrzení čísla");
    const moje = stav.kolo;
    Promise.all([nactiUcet(), stav.cisloSluzby ? null : volej(cestaProfilu(tel))]).then(() => {
      if (moje !== stav.kolo) return;
      if (!stav.ucet) { poOdhlaseni("Přihlášení vypršelo. Přihlaste se prosím znovu."); return; }
      const s2 = senior(tel);
      if (!s2) { stav.zprava = { typ: "chyba", text: "Tohoto seniora už ve svém účtu nemáte." }; jdiNa(""); return; }
      vykresliOvereni(s2, moje);
    }).catch((e) => {
      if (moje !== stav.kolo || vyresOdhlaseni(e)) return;
      const o = el("overeni-obsah");
      o.removeAttribute("aria-busy");
      o.innerHTML = `<div class="blok chyba" role="alert">${ikona("warning", "ikona")}<div><strong>Stav čísla se nepodařilo zjistit.</strong>${esc(e.message)}</div></div>
        <div class="akce"><a class="tlacitko vedlejsi" href="${hashZ("overeni", { tel })}" id="znovu">Zkusit znovu</a></div>`;
      el("znovu").addEventListener("click", (ev) => { ev.preventDefault(); vykresli(); });
    });
    return h2;
  }

  function textNavodu(kod) {
    const cislo = stav.cisloSluzby ? cisloText(stav.cisloSluzby) : "služby Dojedeme";
    return `Pošlete prosím ze svého telefonu SMS s textem ${kod} na číslo ${cislo}. Nevolejte, stačí SMS. Tím službu Dojedeme zapnete. Když pak budete potřebovat k lékaři, pošlete SMS s číslem místa, třeba *11, a přijde vám spoj tam i zpátky.`;
  }

  function hotovoHtml(s) {
    const priklad = s.zkratky && s.zkratky.length ? `*${s.zkratky[0].kod}` : "*11";
    return `<div class="blok uspech hotovo">${ikona("check-circle", "ikona")}<div>
        <h3 id="hotovo-nadpis" tabindex="-1">Hotovo, číslo je ověřené</h3>
        <p>Služba je zapnutá. Když senior pošle SMS s textem <b>${esc(priklad)}</b>, přijde mu spoj tam i zpátky. Číslo se ověřuje jen jednou, nic dalšího není potřeba.</p></div></div>
      <div class="akce">
        <a class="tlacitko" href="${hashZ("karticka", { tel: s.telefon })}">Kartička pro seniora</a>
        <a class="tlacitko vedlejsi" href="#">Zavřít</a>
      </div>`;
  }

  function vykresliOvereni(s, moje) {
    const o = el("overeni-obsah");
    o.removeAttribute("aria-busy");
    if (s.overeno) { o.innerHTML = hotovoHtml(s); return; }
    if (!s.overeni) {
      o.innerHTML = `
        <div class="blok upozorneni">${ikona("hourglass-medium", "ikona")}<div><strong>Kód pro potvrzení vypršel.</strong>Kód platí 48 hodin. Vytvořte nový a předejte ho seniorovi.</div></div>
        <div class="akce"><button type="button" class="tlacitko" id="novy-kod">Nový kód</button></div>
        <p class="pole-chyba" id="novy-kod-chyba" role="alert"></p>`;
      el("novy-kod").addEventListener("click", () => novyKod(s.telefon, el("novy-kod"), el("novy-kod-chyba")));
      return;
    }
    const kod = s.overeni.sms || "*" + s.overeni.kod;
    const cislo = stav.cisloSluzby ? cisloText(stav.cisloSluzby) : null;
    o.innerHTML = `
      <div class="overeni">
        <h3 class="overeni-stitek" id="kod-stitek">Kód pro potvrzení</h3>
        <p class="overeni-kod">${esc(kod)}</p>
        <p class="overeni-text">Senior pošle SMS s textem <b>${esc(kod)}</b> na číslo <b class="nezalomit">${esc(cislo || "služby Dojedeme")}</b>.</p>
        <p>Stačí SMS poslat, nevolá se. Kód platí do ${esc(platnost(s.overeni.plati_do))}. Číslo se potvrzuje jen jednou.</p>
        <div class="akce">
          <button type="button" class="tlacitko" id="kopirovat-navod">Zkopírovat návod pro seniora</button>
          ${navigator.share ? `<button type="button" class="tlacitko vedlejsi" id="poslat-navod">Poslat návod</button>` : ""}
        </div>
        <p class="potvrzeni" id="overeni-akce" role="status"></p>
        <p class="stav ceka cekame">${ikona("hourglass-medium")}<span>Čekáme na SMS od seniora.</span></p>
      </div>`;
    const navod = textNavodu(kod);
    el("kopirovat-navod").addEventListener("click", async () => {
      const ok = await zkopiruj(navod);
      const p = el("overeni-akce");
      p.textContent = "";
      setTimeout(() => { p.textContent = ok ? "Návod je zkopírovaný. Vložte ho třeba do zprávy pro seniora." : `Kopírování v tomto prohlížeči nejde. Kód je ${kod}.`; }, 60);
    });
    const share = el("poslat-navod");
    if (share) share.addEventListener("click", async () => {
      try { await navigator.share({ title: "Dojedeme: potvrzení čísla", text: navod }); } catch { /* zrušeno */ }
    });

    // každých 5 s, dokud je stránka vidět: GET /ucet → overeno
    spustObnovu(async () => {
      try { await nactiUcet(); } catch (e) { if (moje === stav.kolo) vyresOdhlaseni(e); return; }
      if (moje !== stav.kolo) return;
      if (!stav.ucet) { poOdhlaseni("Přihlášení vypršelo. Přihlaste se prosím znovu."); return; }
      const t = senior(s.telefon);
      if (!t) { stav.zprava = { typ: "chyba", text: "Tohoto seniora už ve svém účtu nemáte." }; jdiNa(""); return; }
      if (t.overeno) {
        zastavObnovu();
        el("overeni-obsah").innerHTML = hotovoHtml(t);
        el("hotovo-nadpis").focus();
        hlas("Hotovo, číslo je ověřené. Služba je zapnutá.");
      } else if (!t.overeni) {
        zastavObnovu();
        vykresliOvereni(t, moje);
        hlas("Kód pro potvrzení vypršel. Vytvořte nový.");
      }
    }, OBNOVA_MS);
  }

  // --- kartička pro seniora --------------------------------------------------------------------
  function ukazKarticku(s) {
    const tel = s.telefon;
    const h2 = ukazModal({ nadpis: "Kartička pro seniora", popis: kdoHtml(tel) }, `
      ${!s.overeno ? `<div class="blok upozorneni zprava">${ikona("hourglass-medium", "ikona")}<div><strong>Číslo ještě není potvrzené.</strong>
        Dokud senior nepošle SMS s kódem, služba mu spoje neposílá. <a href="${hashZ("overeni", { tel })}">Ukázat postup potvrzení</a></div></div>` : ""}
      <p>Vytiskněte ji a dejte k telefonu. Je na ní číslo služby a předvolby velkým písmem.</p>
      <div class="karticka" id="karticka" aria-busy="true"><div class="skeleton" style="height:240px"></div></div>
      <div class="akce">
        <button type="button" class="tlacitko" id="tisk-karticky" disabled>Vytisknout kartičku</button>
        <button type="button" class="odkaz-tlacitko" id="kopirovat-karticku" disabled>Zkopírovat text</button>
      </div>
      <p class="potvrzeni" id="karticka-stav" role="status"></p>`, "Kartička pro seniora");
    const moje = stav.kolo;
    let text = "";
    volej(cestaProfilu(tel, "/karticka")).then(({ data }) => {
      if (moje !== stav.kolo) return;
      text = data.text || "";
      const k = el("karticka");
      k.removeAttribute("aria-busy");
      k.innerHTML = kartickaHtml(text);
      el("tisk-karticky").disabled = false;
      el("kopirovat-karticku").disabled = false;
    }).catch((e) => {
      if (moje !== stav.kolo || vyresOdhlaseni(e)) return;
      const k = el("karticka");
      k.removeAttribute("aria-busy");
      k.classList.add("bez-ramu");
      k.innerHTML = `<div class="blok chyba">${ikona("warning", "ikona")}<div><strong>Kartičku se nepodařilo načíst.</strong>${esc(e.message)}</div></div>`;
    });
    el("tisk-karticky").addEventListener("click", () => {
      if (!text) return;
      let t = el("tisk-karticka");
      if (!t) { t = document.createElement("div"); t.id = "tisk-karticka"; t.className = "tisk-karticka"; document.body.appendChild(t); }
      t.innerHTML = kartickaHtml(text);
      document.documentElement.classList.add("tisk-karticky");
      const uklid = () => { document.documentElement.classList.remove("tisk-karticky"); window.removeEventListener("afterprint", uklid); };
      window.addEventListener("afterprint", uklid);
      window.print();
      setTimeout(uklid, 1000);
    });
    el("kopirovat-karticku").addEventListener("click", async () => {
      const ok = text && await zkopiruj(text);
      const p = el("karticka-stav");
      p.textContent = "";
      setTimeout(() => { p.textContent = ok ? "Text kartičky je zkopírovaný." : "Kopírování v tomto prohlížeči nejde. Kartičku můžete vytisknout."; }, 60);
    });
    return h2;
  }

  // --- termíny u lékaře: večer předem přijde seniorovi SMS se spojem, který dorazí včas ----------------
  const DNY_TERMINU = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
  function denTerminu(iso) {
    const [r, m, d] = iso.split("-").map(Number);
    const dt = new Date(r, m - 1, d);
    return `${DNY_TERMINU[dt.getDay()]} ${d}. ${m}.`;
  }
  function terminHtml(t) {
    const kam = t.popis || t.nazev || "Místo";
    const pripominka = t.pripominka ? denTerminu(t.pripominka.slice(0, 10)) : "";
    const stavSms = t.odeslano ? `${ikona("check-circle")} SMS odešla` : `${ikona("clock")} SMS přijde ${esc(pripominka)} v 18:00`;
    return `<li class="termin" data-id="${t.id}">
      <p class="termin-kdy"><b>${esc(denTerminu(t.datum))} v ${esc(t.cas)}</b></p>
      <p class="termin-kam">${esc(kam)}${t.popis && t.nazev ? `<span class="male">${esc(t.nazev)}</span>` : ""}</p>
      ${t.text ? `<p class="sms termin-sms"><span class="sr">Senior dostane SMS: </span>${esc(t.text)}</p>` : ""}
      <p class="male termin-stav">${stavSms}</p>
      <div class="akce">
        <button type="button" class="tlacitko vedlejsi" data-poslat-termin="${t.id}">Poslat SMS hned</button>
        <button type="button" class="odkaz-tlacitko" data-smazat-termin="${t.id}">Smazat termín</button>
      </div>
    </li>`;
  }
  function ukazTerminy(s) {
    const tel = s.telefon;
    const zitra = new Date(); zitra.setDate(zitra.getDate() + 1);
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const predvolby = (s.zkratky || []).map((z) => `<option value="${esc(z.cil_id)}">*${esc(z.kod)} ${esc(z.popis || z.nazev || "")}</option>`).join("");
    const h2 = ukazModal({ nadpis: "Termíny u lékaře", popis: kdoHtml(tel) }, `
      <p>Zadejte termín u lékaře. Den předem v 18:00 pošleme seniorovi SMS, kdy má vyjet, aby tam byl včas, a kdy jede zpátky.</p>
      ${!s.overeno ? `<div class="blok upozorneni zprava">${ikona("hourglass-medium", "ikona")}<div><strong>Číslo ještě není potvrzené.</strong>
        SMS k termínu odejde, až senior potvrdí číslo. <a href="${hashZ("overeni", { tel })}">Ukázat postup potvrzení</a></div></div>` : ""}
      <div class="blok chyba souhrn-chyb" id="termin-chyby" tabindex="-1" hidden></div>
      <form id="form-termin" class="form-termin" novalidate>
        <div class="pole">
          <label for="t-misto">Kam</label>
          <select id="t-misto" required>${predvolby || `<option value="">Senior zatím nemá předvolby</option>`}</select>
        </div>
        <div class="pole-radek">
          <div class="pole">
            <label for="t-datum">Den</label>
            <input type="date" id="t-datum" min="${iso(new Date())}" value="${iso(zitra)}" required>
          </div>
          <div class="pole">
            <label for="t-cas">Čas termínu</label>
            <input type="time" id="t-cas" value="09:00" min="05:00" max="21:00" step="300" required>
          </div>
        </div>
        <div class="pole">
          <label for="t-popis">Poznámka do SMS <span class="male">(nepovinné, třeba Kardiologie)</span></label>
          <input type="text" id="t-popis" maxlength="40" autocomplete="off">
        </div>
        <div class="akce"><button type="submit" class="tlacitko" ${predvolby ? "" : "disabled"}>Přidat termín</button></div>
      </form>
      <h3 class="seznam-nadpis">Naplánované termíny</h3>
      <div id="terminy-obsah" aria-busy="true"><div class="skeleton" style="height:120px"></div></div>
      <p class="potvrzeni" id="terminy-stav" role="status"></p>`, "Termíny u lékaře");
    const moje = stav.kolo;
    const obsah = el("terminy-obsah");
    const hlaseni = (t) => { const p = el("terminy-stav"); p.textContent = ""; setTimeout(() => { p.textContent = t; }, 60); };
    function nacti() {
      return volej(cestaProfilu(tel, "/terminy")).then(({ data }) => {
        if (moje !== stav.kolo) return;
        obsah.removeAttribute("aria-busy");
        const t = data.terminy || [];
        obsah.innerHTML = t.length ? `<ul class="seznam-terminu">${t.map(terminHtml).join("")}</ul>`
          : `<p class="male">Zatím žádné termíny.</p>`;
      }).catch((e) => {
        if (moje !== stav.kolo || vyresOdhlaseni(e)) return;
        obsah.removeAttribute("aria-busy");
        obsah.innerHTML = `<div class="blok chyba">${ikona("warning", "ikona")}<div><strong>Termíny se nepodařilo načíst.</strong>${esc(e.message)}</div></div>`;
      });
    }
    nacti();
    el("form-termin").addEventListener("submit", async (e) => {
      e.preventDefault();
      vycistiChyby(el("form-termin"), "termin-chyby");
      const telo = { cil_id: el("t-misto").value, datum: el("t-datum").value, cas: el("t-cas").value, popis: el("t-popis").value.trim() };
      const chyby = [];
      if (!telo.cil_id) chyby.push(chybaPole("t-misto", "Vyberte místo z předvoleb."));
      if (!telo.datum) chyby.push(chybaPole("t-datum", "Zadejte den termínu."));
      if (!telo.cas) chyby.push(chybaPole("t-cas", "Zadejte čas termínu."));
      if (chyby.length) { ukazChyby("termin-chyby", chyby); return; }
      const tl = e.submitter || el("form-termin").querySelector("button[type=submit]");
      tl.disabled = true;
      try {
        await volej(cestaProfilu(tel, "/terminy"), { metoda: "POST", telo });
        el("t-popis").value = "";
        await nacti();
        hlaseni("Termín je uložený. Seniorovi přijde SMS den předem v 18:00.");
      } catch (err) {
        if (!vyresOdhlaseni(err)) ukazChyby("termin-chyby", [{ text: err.message }], "Termín se nepodařilo uložit.");
      } finally { tl.disabled = false; }
    });
    obsah.addEventListener("click", async (e) => {
      const p = e.target.closest("[data-poslat-termin]"), sm = e.target.closest("[data-smazat-termin]");
      if (!p && !sm) return;
      const id = (p || sm).dataset.poslatTermin || (p || sm).dataset.smazatTermin;
      (p || sm).disabled = true;
      try {
        if (p) {
          const { data } = await volej(cestaProfilu(tel, `/terminy/${id}/poslat`), { metoda: "POST", telo: {} });
          hlaseni(data.fronta ? "SMS je odeslaná. Z telefonu služby odejde za chvíli." : "SMS je odeslaná.");
        } else {
          await volej(cestaProfilu(tel, `/terminy/${id}`), { metoda: "DELETE" });
          hlaseni("Termín je smazaný.");
        }
        await nacti();
      } catch (err) {
        if (!vyresOdhlaseni(err)) hlaseni(err.message);
        (p || sm).disabled = false;
      }
    });
    return h2;
  }

  // --- poslat spoj seniorovi (okno #spoj): odkud pojede (domov nebo jiná adresa), kam pojede, kdy pojede ----------
  function vychoziKdy() {
    const d = new Date();
    if (d.getHours() >= 18) { d.setDate(d.getDate() + 1); d.setHours(7, 0, 0, 0); }   // večer už zítra od 7:00
    const z = (n) => String(n).padStart(2, "0");
    return { datum: D.isoDatum(d), cas: `${z(d.getHours())}:${z(d.getMinutes())}` };
  }
  const nazevUseku = (u) => ({ bus: "Autobus", vlak: "Vlak", tramvaj: "Tramvaj", trolejbus: "Trolejbus" }[u.typ] || "Spoj");
  function spojHtml(t, i, muzePoslat) {
    const jizdy = (t.useky || []).filter((u) => u.typ !== "pesky");
    const prvni = jizdy[0];
    return `<li class="spoj-volba">
      <div class="spoj-cas"><b>${esc(t.odjezd)}</b> ${ikona("arrow-right")} <b>${esc(t.prijezd)}</b></div>
      <p class="spoj-detail">${esc(D.minuty(t.minut))}, ${esc(D.prestupy(t.prestupy || 0))}${prvni ? `. ${esc(nazevUseku(prvni))}${prvni.linka ? " " + esc(prvni.linka) : ""} ze zastávky ${esc(prvni.z ? prvni.z.nazev : "")} ${esc(vCas(prvni.odjezd))}` : ""}.</p>
      <p class="spoj-akce"><button type="button" class="tlacitko" data-poslat-spoj="${i}"${muzePoslat ? "" : " disabled"}>${ikona("paper-plane-tilt")}Poslat SMS seniorovi</button></p>
      <div class="spoj-vysledek" role="status"></div>
    </li>`;
  }
  function ukazSpoj(s) {
    const tel = s.telefon;
    const kdo = nazevSeniora(tel);
    const { datum, cas } = vychoziKdy();
    const muzePoslat = s.overeno && s.aktivni;
    const predvolby = (s.zkratky || []).map((z, i) => `<div class="volba">
        <input type="radio" name="sp-kam" id="sp-kam-${i}" value="${esc(z.cil_id)}" ${i === 0 ? "checked" : ""}>
        <label for="sp-kam-${i}"><span class="pv-kod">*${esc(z.kod)}</span> ${esc(z.popis || z.nazev || "Uložené místo")}</label></div>`).join("");
    const h = ukazModal({ nadpis: "Poslat spoj", popis: `${esc(kdo)}${jmeno(tel) ? `, ${esc(telText(tel))}` : ""}`, siroke: true }, `
      ${muzePoslat ? "" : `<div class="blok upozorneni zprava">${ikona("hourglass-medium", "ikona")}<div><strong>${s.overeno ? "Senior má službu vypnutou." : "Číslo ještě není potvrzené."}</strong>
        ${s.overeno ? "Zapne si ji SMS s textem *START. Spoj teď najdete, ale poslat ho nepůjde." : "Spoj teď najdete, poslat ho půjde, až senior potvrdí číslo SMS kódem."}</div></div>`}
      <div class="blok chyba souhrn-chyb" id="sp-chyby" tabindex="-1" hidden></div>
      <form id="form-spoj" class="form-spoj" novalidate>
        <fieldset class="sp-blok sp-odkud">
          <legend>${ikona("house")}Odkud pojede</legend>
          <div class="volba">
            <input type="radio" name="sp-odkud" id="sp-odkud-domov" value="domov" checked>
            <label for="sp-odkud-domov">Z domova<span class="volba-detail">${esc(s.bydliste_popis || "bydliště uložené v systému")}</span></label>
          </div>
          <div class="volba">
            <input type="radio" name="sp-odkud" id="sp-odkud-jinde" value="jinde">
            <label for="sp-odkud-jinde">Odjinud</label>
          </div>
          <div class="naseptavac" id="nas-sp-odkud" hidden>
            <label for="sp-adresa">Adresa, odkud pojede</label>
            <input id="sp-adresa" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="sp-adresa-seznam"
                   aria-describedby="sp-adresa-stav sp-adresa-chyba" autocomplete="off" spellcheck="false" placeholder="například Nejdek, Karlovarská 1">
            <ul id="sp-adresa-seznam" role="listbox" aria-label="Nalezené adresy" hidden></ul>
            <p class="naseptavac-stav" id="sp-adresa-stav" aria-live="polite"></p>
            <p class="pole-chyba" id="sp-adresa-chyba"></p>
          </div>
        </fieldset>
        <fieldset class="sp-blok sp-kam">
          <legend>${ikona("map-pin")}Kam pojede</legend>
          ${predvolby}
          <div class="volba">
            <input type="radio" name="sp-kam" id="sp-kam-jine" value="" ${predvolby ? "" : "checked"}>
            <label for="sp-kam-jine">Jiné místo</label>
          </div>
          <div class="sp-jine" id="sp-jine" ${predvolby ? "hidden" : ""}>
            <label for="sp-hledat">Jméno lékaře, název místa nebo obec</label>
            <div class="pole-s-tlacitkem">
              <input type="search" id="sp-hledat" autocomplete="off" aria-describedby="sp-hledat-chyba">
              <button type="button" class="tlacitko vedlejsi" id="sp-hledat-tlacitko">Hledat</button>
            </div>
            <p class="pole-chyba" id="sp-hledat-chyba"></p>
            <div id="sp-cile" aria-live="polite"></div>
          </div>
        </fieldset>
        <fieldset class="sp-blok sp-kdy">
          <legend>${ikona("clock")}Kdy pojede</legend>
          <div class="pole-radek">
            <div class="pole"><label for="sp-datum">Den</label><input type="date" id="sp-datum" value="${datum}" required></div>
            <div class="pole"><label for="sp-cas">Odjezd od</label><input type="time" id="sp-cas" value="${cas}" step="300" required></div>
          </div>
        </fieldset>
        <div class="akce"><button type="submit" class="tlacitko velke">${ikona("magnifying-glass")}Najít spoje</button></div>
      </form>
      <div id="sp-vysledky" aria-live="polite"></div>`, `Poslat spoj: ${kdo}`);

    // odkud: domov z profilu, nebo adresa z našeptávače
    let jinde = null;
    const nas = el("nas-sp-odkud");
    el("form-spoj").addEventListener("change", (e) => {
      if (e.target.name === "sp-odkud") { nas.hidden = e.target.value !== "jinde"; if (!nas.hidden) el("sp-adresa").focus(); }
      if (e.target.name === "sp-kam") { const j = el("sp-jine"); j.hidden = e.target.id !== "sp-kam-jine"; if (!j.hidden && !e.target.value) el("sp-hledat").focus(); }
    });
    naseptavacAdres(nas, (a) => { jinde = a ? { lat: a.lat, lon: a.lon, popis: a.adresa } : null; if (a) el("sp-adresa-chyba").textContent = ""; });
    const odkud = () => (el("sp-odkud-jinde").checked ? jinde
      : { lat: s.bydliste_lat, lon: s.bydliste_lon, popis: s.bydliste_popis || "domov" });

    // jiné místo: hledání v /cile, výsledky jako další volby „Kam pojede“
    let cile = [];
    async function hledejCil() {
      const q = el("sp-hledat").value.trim();
      el("sp-hledat-chyba").textContent = "";
      if (q.replace(/\s/g, "").length < 2) { el("sp-hledat-chyba").textContent = "Napište aspoň 2 písmena."; return; }
      const z = odkud() || { lat: s.bydliste_lat, lon: s.bydliste_lon };
      el("sp-cile").innerHTML = `<p class="male">Hledáme…</p>`;
      try {
        const d = await D.api("/cile", { parametry: { q, lat: z.lat, lon: z.lon, datum: el("sp-datum").value, cas: el("sp-cas").value, limit: 8 } });
        cile = d.cile || [];
        el("sp-cile").innerHTML = cile.length ? `<div class="sp-cile-seznam">${cile.map((c, i) => `<div class="volba">
            <input type="radio" name="sp-kam" id="sp-cil-${i}" value="${esc(c.id)}">
            <label for="sp-cil-${i}">${esc(c.nazev)}<span class="volba-detail">${esc([c.typ_nazev, c.adresa || c.obec].filter(Boolean).join(", "))}</span></label></div>`).join("")}</div>`
          : `<p>Nic jsme nenašli. Zkuste jen příjmení nebo obec.</p>`;
        const prvni = el("sp-cil-0");
        if (prvni) { prvni.checked = true; prvni.focus(); }
      } catch (e) { el("sp-cile").innerHTML = `<p class="pole-chyba">${esc(e.message)}</p>`; }
    }
    el("sp-hledat-tlacitko").addEventListener("click", hledejCil);
    el("sp-hledat").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); hledejCil(); } });

    // najít spoje
    let posledni = null;
    el("form-spoj").addEventListener("submit", async (e) => {
      e.preventDefault();
      vycistiChyby(el("form-spoj"), "sp-chyby");
      const z = odkud();
      const kam = el("form-spoj").querySelector("input[name=sp-kam]:checked");
      const chyby = [];
      if (!z) chyby.push(chybaPole("sp-adresa", "Vyberte adresu, odkud pojede, ze seznamu."));
      if (!kam || !kam.value) chyby.push(chybaPole("sp-hledat", "Vyberte, kam pojede: předvolbu, nebo najděte jiné místo."));
      if (!el("sp-datum").value || !el("sp-cas").value) chyby.push({ text: "Zadejte den a čas odjezdu." });
      if (chyby.length) { ukazChyby("sp-chyby", chyby); return; }
      const vysl = el("sp-vysledky");
      const tl = e.submitter || el("form-spoj").querySelector("[type=submit]");
      tl.disabled = true;
      vysl.innerHTML = `<p class="male">Hledáme spoje…</p>`;
      const parametry = { z_lat: z.lat, z_lon: z.lon, cil_id: kam.value, datum: el("sp-datum").value, cas: el("sp-cas").value, pocet: 4 };
      try {
        const d = await D.api("/spojeni", { parametry });
        posledni = { d, parametry, odjinud: el("sp-odkud-jinde").checked };
        const tam = d.tam || [];
        const zpet = d.posledni_zpet ? `Poslední spoj zpátky ${vCas(d.posledni_zpet.odjezd)}.` : d.zpet_mozne === false ? "Ten den se už zpátky nedostane." : "";
        vysl.innerHTML = `<h3 class="sp-nadpis">Spoje ${esc(d.den || "")}: ${esc(d.cil ? d.cil.nazev : "")}</h3>
          ${d.jen_pesky ? `<p>Je to blízko, dojde pěšky.</p>` : ""}
          ${tam.length ? `<p class="male">Odkud: ${esc(z.popis || "")}. ${esc(zpet)} V SMS pošleme spoj tam i spoje zpátky (po 45 minutách u lékaře).</p>
            <ol class="spoje-seznam">${tam.map((t, i) => spojHtml(t, i, muzePoslat)).join("")}</ol>`
            : `<p>V tento den a čas tam spoj nejede. Zkuste jiný den nebo dřívější čas.</p>`}`;
        const h3 = vysl.querySelector(".sp-nadpis");
        if (h3) { h3.setAttribute("tabindex", "-1"); h3.focus(); }
      } catch (err) {
        vysl.innerHTML = `<div class="blok chyba">${ikona("warning", "ikona")}<div><strong>Spoje se nepodařilo najít.</strong>${esc(err.message)}</div></div>`;
      } finally { tl.disabled = false; }
    });

    // poslat vybraný spoj SMS (server text složí sám ze stejných parametrů)
    el("sp-vysledky").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-poslat-spoj]");
      if (!b || !posledni) return;
      const t = (posledni.d.tam || [])[+b.dataset.poslatSpoj];
      const vystup = b.closest(".spoj-volba").querySelector(".spoj-vysledek");
      b.disabled = true;
      b.innerHTML = `${ikona("paper-plane-tilt")}Posíláme SMS…`;
      try {
        const { data } = await volej("/ucet/poslat-spoj", { metoda: "POST", telo: {
          telefon: tel, ...posledni.parametry, cas: String(t.odjezd).padStart(5, "0"), pobyt: 45, odjinud: posledni.odjinud } });
        b.innerHTML = `${ikona("check")}SMS je poslaná`;
        vystup.innerHTML = `<div class="blok uspech">${ikona("check-circle", "ikona")}<div><strong>SMS jsme poslali: ${esc(kdo)}.</strong>${data && data.fronta ? "Odejde z telefonu služby během chvilky." : ""}</div></div>
          ${data && data.text ? `<p class="sms-popisek">Poslaný text</p><div class="sms odeslana">${esc(data.text)}</div>` : ""}`;
      } catch (err) {
        if (vyresOdhlaseni(err)) return;
        b.disabled = false;
        b.innerHTML = `${ikona("paper-plane-tilt")}Poslat SMS seniorovi`;
        vystup.innerHTML = `<div class="blok chyba">${ikona("warning", "ikona")}<div><strong>SMS se nepodařilo poslat.</strong>${esc(err.message)}</div></div>`;
      }
    });
    return h;
  }

  /** Text kartičky z API (řádky) → jednoduchá kartička: nadpis, velké číslo, seznam „*11 = kam“, pár vět. */
  function kartickaHtml(text) {
    const radky = String(text).split("\n");
    let html = "", kody = [];
    const vypisKody = () => { if (kody.length) { html += `<ul class="k-kody">${kody.join("")}</ul>`; kody = []; } };
    radky.forEach((r, i) => {
      const m = r.match(/^(\*\d+)\s{2,}(.*)$/);
      if (m) { kody.push(`<li><span class="k-kod">${esc(m[1])}</span><span class="k-misto">${esc(m[2])}</span></li>`); return; }
      vypisKody();
      if (!r.trim()) return;
      if (i === 0) { html += `<p class="k-nadpis">${esc(r)}</p>`; return; }
      const c = i === 1 && r.match(/^(.*?číslo)\s+(.+)$/);
      if (c) { html += `<p class="k-cislo">${esc(c[1])}<strong>${esc(c[2])}</strong></p>`; return; }
      html += `<p class="k-radek">${esc(r)}</p>`;
    });
    vypisKody();
    return html;
  }

  // --- start ------------------------------------------------------------------------------
  async function start() {
    try {
      await nactiUcet();
    } catch (e) {
      nacitani.removeAttribute("aria-busy");
      nacitani.innerHTML = `<div class="blok chyba" role="alert">${ikona("warning", "ikona")}<div><strong>Stránku se nepodařilo načíst.</strong>${esc(e.message)}</div></div>
        <div class="akce"><button type="button" class="tlacitko" id="zkusit-znovu">Zkusit znovu</button></div>`;
      el("zkusit-znovu").addEventListener("click", () => location.reload());
      return;
    }
    window.addEventListener("hashchange", vykresli);
    vykresli();
  }
  start();
})();
