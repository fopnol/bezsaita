// Draft opens: the draft page reports "someone opened ?d=<slug>", the tool asks how many times and when.
// One blob per open (key "<slug>/<time>-<random>"), so two opens at the same moment never overwrite each other.
// Only the time of the open is stored: no IP, no browser, nothing about the visitor.
import { getStore } from "@netlify/blobs";

export const config = {
  path: "/api/hit",
  method: ["GET", "POST"],
  rateLimit: { windowLimit: 40, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

const SLUG = /^[a-z0-9-]{3,60}$/;
const ORIGINS = new Set(["https://fopnol.github.io", "https://bezsaita.netlify.app"]);

export default async (req) => {
  const url = new URL(req.url);
  const store = getStore("opens");

  if (req.method === "POST") {
    const slug = String(url.searchParams.get("s") || "").toLowerCase();
    if (!SLUG.test(slug)) return new Response(null, { status: 400 });
    const ua = req.headers.get("user-agent") || "";
    if (/bot|crawl|spider|preview|vkshare|facebookexternalhit|headless/i.test(ua)) return new Response(null, { status: 204 });
    const key = slug + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    await store.set(key, "");
    return new Response(null, { status: 204 });
  }

  // GET ?s=slug1,slug2,… → { slug: { n, last, times: [newest first, up to 5] } }
  const want = new Set(String(url.searchParams.get("s") || "").toLowerCase().split(",").filter((s) => SLUG.test(s)).slice(0, 400));
  const out = {};
  if (want.size) {
    const { blobs } = await store.list();
    for (const b of blobs) {
      const i = b.key.indexOf("/");
      const slug = b.key.slice(0, i);
      if (!want.has(slug)) continue;
      const ts = parseInt(b.key.slice(i + 1), 10);
      if (!ts) continue;
      (out[slug] ||= []).push(ts);
    }
    for (const s in out) {
      const t = out[s].sort((a, b) => b - a);
      out[s] = { n: t.length, last: t[0], times: t.slice(0, 5) };
    }
  }
  const origin = req.headers.get("origin") || "";
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  if (ORIGINS.has(origin)) { headers["access-control-allow-origin"] = origin; headers["vary"] = "origin"; }
  return new Response(JSON.stringify(out), { headers });
};
