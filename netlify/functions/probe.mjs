// Temporary diagnostic: which free web search endpoints answer from Netlify's servers.
export const config = { path: "/api/probe", method: ["GET"], rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] } };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
async function get(url, opts = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal, redirect: "follow", headers: { "user-agent": UA, "accept-language": "ru,en;q=0.8", accept: "text/html,application/json,*/*", ...(opts.headers || {}) } });
    const text = await r.text();
    return { status: r.status, len: text.length, text };
  } catch (e) { return { status: 0, err: String(e.message || e), text: "" }; } finally { clearTimeout(t); }
}
const hosts = (urls) => [...new Set(urls.map((u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } }).filter(Boolean))].slice(0, 8);
export default async (req) => {
  const q = new URL(req.url).searchParams.get("q") || "барбершоп Борода Чебоксары";
  const e = encodeURIComponent(q);
  const tests = {
    ddg_html: async () => { const r = await get("https://html.duckduckgo.com/html/?q=" + e); return { ...r, hosts: hosts([...r.text.matchAll(/uddg=([^&"']+)/g)].map((m) => decodeURIComponent(m[1]))) }; },
    ddg_lite: async () => { const r = await get("https://lite.duckduckgo.com/lite/?q=" + e); return { ...r, hosts: hosts([...r.text.matchAll(/class=['"]result-link['"][^>]*href=['"]([^'"]+)/g), ...r.text.matchAll(/uddg=([^&"']+)/g)].map((m) => { try { return decodeURIComponent(m[1]); } catch { return m[1]; } })) }; },
    bing: async () => { const r = await get("https://www.bing.com/search?q=" + e + "&setlang=ru&cc=RU&mkt=ru-RU"); return { ...r, hosts: hosts([...r.text.matchAll(/<cite[^>]*>([^<]+)</g)].map((m) => "https://" + m[1].replace(/<[^>]+>/g, "").split(/[\s›]/)[0].replace(/^https?:\/\//, ""))) }; },
    mojeek: async () => { const r = await get("https://www.mojeek.com/search?q=" + e); return { ...r, hosts: hosts([...r.text.matchAll(/<a[^>]+class="ob"[^>]+href="([^"]+)"/g)].map((m) => m[1])) }; },
    yandex_html: async () => { const r = await get("https://yandex.ru/search/?text=" + e); return { status: r.status, len: r.len, captcha: /captcha|showcaptcha/i.test(r.text) }; },
    startpage: async () => { const r = await get("https://www.startpage.com/sp/search?query=" + e); return { ...r, hosts: hosts([...r.text.matchAll(/class="result-title result-link[^"]*"\s+href="([^"]+)"/g), ...r.text.matchAll(/data-testid="gl-title-link"[^>]*href="([^"]+)"/g)].map((m) => m[1])) }; },
  };
  const out = {};
  await Promise.all(Object.entries(tests).map(async ([k, f]) => { const r = await f(); delete r.text; out[k] = r; }));
  return Response.json({ q, out });
};
