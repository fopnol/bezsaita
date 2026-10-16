// Checks whether a local business already has its own website.
// 1) guesses likely domains from the name and checks they exist (DNS),
// 2) looks the business up in a web search,
// then opens each candidate page and accepts it only if it mentions the business:
// its phone number, or its name together with the city.
import dns from "node:dns/promises";
import { domainToASCII } from "node:url";

export const config = {
  path: "/api/findsite",
  method: ["POST"],
  rateLimit: { windowLimit: 90, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

const AGGREGATORS = /(^|\.)(2gis|yandex|ya|google|vk|vkontakte|ok|instagram|facebook|t|telegram|youtube|wikipedia|zoon|flamp|yell|avito|tripadvisor|restoclub|afisha|spr|orgpage|rusprofile|list-org|sbis|checko|zachestnyibiznes|cataloxy|yp|spravker|gde|infodoctor|prodoctorov|napopravku|beauty\.?com|youdo|profi|uslugio|dikidi|yclients|booksy|duckduckgo|bing|mail|rambler|dzen|tiktok|pinterest|whatsapp|wa|apple|maps|fresha|hh|superjob|irecommend|otzovik|otzyvru|2gis-otzyvy|zoon-otzyvy|bizzone|rubrikator|kartaslov|kontakty|mapcarta|nominatim|openstreetmap|wikimapia|foursquare|tutu|booking|ostrovok|sutochno|cian|domclick)\.[a-zа-я.]+$/i;
const GENERIC = /^(автосервис|автотехцентр|салон|красоты|кафе|кофейня|пекарня|барбершоп|парикмахерская|студия|магазин|цветы|цветов|ателье|стоматология|стоматологическая|клиника|ремонт|обуви|шиномонтаж|автомойка|ресторан|бар|ветклиника|ветеринарная|оптика|мастерская|сервис|центр|зоомагазин|кондитерская|столовая|ооо|ип|сеть|студия-салон|маникюра|массажа|beauty|nail|studio|cafe|coffee|bar|shop|и|на|у|в)$/i;
const NICHE_EN = {
  barber: ["barber", "barbershop"], salon: ["salon", "beauty"], nails: ["nails", "nail"], massage: ["massage", "spa"],
  cafe: ["cafe", "coffee"], bakery: ["bakery", "bread"], restaurant: ["restaurant", "rest"],
  car: ["auto", "service"], tyres: ["shina", "tyres"], wash: ["wash", "moika"],
  dentist: ["dent", "stom"], clinic: ["clinic", "med"], vet: ["vet", "zoo"], optic: ["optic", "optika"],
  tailor: ["atelier", "atelie"], cobbler: ["master", "remont"], phone: ["service", "remont"], workshop: ["master", "remont"],
  florist: ["flowers", "cvety"], pet: ["zoo", "pet"], store: ["shop", "store"],
};
const TR = { а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya" };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

const norm = (s) => String(s || "").toLowerCase().replace(/ё/g, "е");
const translit = (s) => norm(s).split("").map((c) => (c in TR ? TR[c] : c)).join("").replace(/[^a-z0-9]+/g, "");
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

function brandWords(name) {
  const words = norm(name).replace(/[«»"“”„()'’.,!?:;]/g, " ").split(/\s+/).filter(Boolean);
  const core = words.filter((w) => !GENERIC.test(w));
  return core.length ? core : words;
}

function domainCandidates(name, city, niche) {
  const words = brandWords(name);
  const b = translit(words.join("")), bh = words.map(translit).filter(Boolean).join("-");
  const c = translit(city);
  if (!b || b.length < 3) return [];
  const out = new Set();
  const add = (label, tld = "ru") => { if (label && label.length >= 3 && label.length <= 40) out.add(label + "." + tld); };
  add(b); add(bh); add(b, "com"); add(b, "online"); add(b, "site"); add(b, "pro");
  for (const n of NICHE_EN[niche] || []) { add(b + n); add(b + "-" + n); add(n + "-" + b); }
  if (c) { add(b + "-" + c); add(b + c); }
  const cyr = words.join("").replace(/[^а-я0-9-]/g, "");
  if (cyr.length >= 3) { const ascii = domainToASCII(cyr + ".рф"); if (ascii) out.add(ascii); }
  return [...out].slice(0, 16);
}

async function exists(host) {
  try { const a = await withTimeout(dns.resolve4(host), 2500); return a.length > 0; } catch { return false; }
}

async function fetchText(url, ms = 6000, maxBytes = 600_000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { redirect: "follow", signal: ctl.signal, headers: { "user-agent": UA, "accept-language": "ru,en;q=0.8", accept: "text/html,*/*" } });
    const type = r.headers.get("content-type") || "";
    if (!r.ok || (type && !/html|text/i.test(type))) return null;
    const buf = new Uint8Array(await r.arrayBuffer()).slice(0, maxBytes);
    let charset = (type.match(/charset=([\w-]+)/i) || [])[1];
    if (!charset) { const head = new TextDecoder("latin1").decode(buf.slice(0, 4000)); charset = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1]; }
    let text; try { text = new TextDecoder(charset || "utf-8").decode(buf); } catch { text = new TextDecoder("utf-8").decode(buf); }
    return { url: r.url || url, html: text };
  } catch { return null; } finally { clearTimeout(t); }
}

function pageText(html) {
  return norm(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ").replace(/&quot;/g, '"').replace(/&laquo;|&raquo;/g, '"').replace(/&amp;/g, "&")).replace(/\s+/g, " ");
}
function phoneRegex(phone) {
  const d = String(phone || "").split(/[;,]/)[0].replace(/\D/g, "");
  if (d.length < 7) return null;
  const tail = d.slice(-7).split("").join("[\\s\\-().]*");
  return new RegExp(tail);
}

function verify(html, ctx) {
  const text = pageText(html), raw = html;
  const why = [];
  if (ctx.phoneRe && (ctx.phoneRe.test(text) || ctx.phoneRe.test(raw.replace(/<[^>]+>/g, " ")))) why.push("телефон");
  const brandHit = ctx.brand.length && ctx.brand.every((w) => w.length < 3 || text.includes(w));
  if (brandHit) why.push("название");
  if (ctx.city && text.includes(ctx.city)) why.push("город");
  if (ctx.street && text.includes(ctx.street)) why.push("адрес");
  const ok = why.includes("телефон") || (brandHit && (why.includes("город") || why.includes("адрес")));
  return ok ? why : null;
}

/* Web search (best effort): result links from the HTML pages of two search engines. */
async function searchLinks(q) {
  const links = [];
  const ddg = await fetchText("https://html.duckduckgo.com/html/?kl=ru-ru&q=" + encodeURIComponent(q), 7000);
  if (ddg) for (const m of ddg.html.matchAll(/uddg=([^&"']+)/g)) { try { links.push(decodeURIComponent(m[1])); } catch {} }
  if (links.length < 3) {
    const bing = await fetchText("https://www.bing.com/search?setlang=ru&cc=ru&q=" + encodeURIComponent(q), 7000);
    if (bing) for (const m of bing.html.matchAll(/<h2[^>]*>\s*<a[^>]+href="(https?:\/\/[^"]+)"/g)) links.push(m[1].replace(/&amp;/g, "&"));
  }
  const seen = new Set(), out = [];
  for (const u of links) {
    const host = hostOf(u);
    if (!host || AGGREGATORS.test(host) || seen.has(host)) continue;
    seen.add(host); out.push("https://" + host + "/");
    if (out.length >= 4) break;
  }
  return { out, searched: !!(links.length) };
}

export default async (req) => {
  let b;
  try { b = await req.json(); } catch { return Response.json({ error: "bad request" }, { status: 400 }); }
  const name = String(b.name || "").slice(0, 120).trim(), city = String(b.city || "").slice(0, 60).trim();
  if (name.length < 2) return Response.json({ error: "name required" }, { status: 400 });
  const ctx = {
    brand: brandWords(name).filter((w) => w.length >= 3).slice(0, 3),
    city: (() => { const c = norm(city); return c.length > 5 ? c.slice(0, -2) : c; })(), street: norm(String(b.addr || "").replace(/,?\s*\d.*$/, "")).replace(/^(улица|ул\.?|проспект|пр-т|переулок|пер\.?)\s+/, "").trim().slice(0, 40),
    phoneRe: phoneRegex(b.phone),
  };
  if (ctx.street.length < 4) ctx.street = "";

  const tried = new Set();
  const check = async (url, how) => {
    const host = hostOf(url); if (!host || tried.has(host)) return null; tried.add(host);
    const page = await fetchText(url);
    if (!page) return null;
    const why = verify(page.html, ctx);
    return why ? { found: true, url: "https://" + hostOf(page.url || url), how, why } : null;
  };

  // 1. Likely domains that exist
  const cands = domainCandidates(name, city, String(b.niche || ""));
  const live = (await Promise.all(cands.map(async (d) => ((await exists(d)) ? d : null)))).filter(Boolean);
  for (const res of await Promise.all(live.slice(0, 6).map((d) => check("https://" + d + "/", "domain")))) if (res) return Response.json(res);

  // 2. Web search
  const { out, searched } = await searchLinks([name, city].filter(Boolean).join(" "));
  for (const res of await Promise.all(out.map((u) => check(u, "search")))) if (res) return Response.json(res);

  return Response.json({ found: false, checkedDomains: cands.length, searched, checkedPages: tried.size });
};
