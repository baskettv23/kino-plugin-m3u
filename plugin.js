/// <reference path="./kino.d.ts" />
// Mis Listas M3U -- a Kino plugin that turns the M3U playlists the person adds into live channels.
//
// The person pastes list addresses in Ajustes > Plugins > Mis Listas M3U. Each `url` field of the
// `playlists` setting becomes an allowed host for this install only (the manifest declares
// `"hosts": []`). Kino downloads and parses every list itself (KinoPlaylist): each group-title is a
// category in the En vivo tab, with the channel logos, and an optional XMLTV guide gives the
// programme grid.

const MAX_LISTS = 10;
const ALLOWED_REFRESH = [1, 6, 12, 24];

const lists = () => {
  const raw = kino.config.get("playlists");
  return Array.isArray(raw) ? raw.filter((p) => p && p.url) : [];
};

function splitGroups(text) {
  return String(text || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
}

function streamHeaders() {
  const headers = {};
  const ua = String(kino.config.get("userAgent") || "").trim();
  const ref = String(kino.config.get("referer") || "").trim();
  if (ua) headers["User-Agent"] = ua;
  if (ref) headers["Referer"] = ref;
  return Object.keys(headers).length ? headers : undefined;
}

function refreshHours() {
  const n = Number(kino.config.get("refresh") || 12);
  return ALLOWED_REFRESH.includes(n) ? n : 12;
}

// One KinoPlaylist per list the person added: Kino downloads it, groups it and refreshes it.
export async function liveCategories() {
  const out = [];
  for (const p of lists().slice(0, MAX_LISTS)) {
    const playlist = { url: String(p.url).trim(), format: "m3u", refreshHours: refreshHours() };
    const headers = streamHeaders();
    if (headers) playlist.streamHeaders = headers;
    const hide = splitGroups(p.hide);
    if (hide.length) playlist.hideGroups = hide;
    if (p.epg && String(p.epg).trim()) playlist.epg = { url: String(p.epg).trim(), format: "xmltv" };
    out.push({ playlist });
  }
  return out;
}

// Channels come from the playlists themselves; nothing is listed by hand.
export async function liveChannels() {
  return { items: [], next: null };
}

// Plain title search is not offered: channels are searched from the En vivo tab.
export async function search() {
  return [];
}

// Playlist entries play directly; this only runs for a ref this plugin never hands out.
export async function resolve() {
  throw new Error("Este plugin solo reproduce los canales de tus listas M3U");
}

async function check(entry) {
  const started = Date.now();
  const r = await kino.fetch(String(entry.url).trim(), { timeoutMs: 15000 });
  if (!r.ok) throw new Error("respondió " + r.status);
  const text = r.text();
  if (!/^\s*#EXTM3U/i.test(text)) throw new Error("no parece una lista M3U (falta #EXTM3U)");
  const channels = (text.match(/^#EXTINF/gim) || []).length;
  return { channels, ms: Date.now() - started };
}

function failure(e) {
  if (e && e.code === "timeout") return "tardó demasiado en responder";
  if (e && e.code === "network") return "no se pudo conectar";
  if (e && e.code === "host_not_allowed") return "dirección no permitida: guarda los ajustes primero";
  return (e && e.message) || "error desconocido";
}

export async function settingsStatus() {
  const all = lists();
  if (!all.length) return { estado: "Agrega al menos una lista M3U" };
  return { estado: all.length === 1 ? "1 lista guardada" : all.length + " listas guardadas" };
}

export async function action(key) {
  if (key === "probar") {
    const all = lists();
    if (!all.length) return { message: "Primero agrega una lista." };
    const lines = [];
    for (const [i, entry] of all.entries()) {
      try {
        const c = await check(entry);
        lines.push(`Lista ${i + 1}: ${c.channels} canales (${c.ms} ms)`);
      } catch (e) {
        lines.push(`Lista ${i + 1}: ${failure(e)}`);
      }
    }
    return { message: lines.join("\n").slice(0, 290) };
  }
  if (key === "quitarAgente") {
    return { message: "Listo: los canales usan el User-Agent de Kino.", clearSettings: ["userAgent"] };
  }
  return null;
}

// Checked before Kino saves: formats only, offline.
export async function validateSettings(values) {
  const errors = {};
  const ps = Array.isArray(values.playlists) ? values.playlists : [];
  const seen = new Set();
  for (const p of ps) {
    let u;
    try {
      u = new URL(String(p.url || "").trim());
    } catch {
      errors.playlists = "Una de las listas no es una dirección completa (empieza por http:// o https://)";
      break;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      errors.playlists = "Las listas deben empezar por http:// o https://";
      break;
    }
    const k = u.href;
    if (seen.has(k)) {
      errors.playlists = "Hay una lista repetida";
      break;
    }
    seen.add(k);
  }
  if (/[\r\n]/.test(String(values.userAgent || ""))) errors.userAgent = "El User-Agent va en una sola línea";
  return Object.keys(errors).length ? errors : null;
}
