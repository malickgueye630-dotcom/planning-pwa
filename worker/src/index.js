/* ===========================================================
   Mon Planning — service de notifications push (Cloudflare Worker)
   ===========================================================
   Implémente le protocole Web Push (RFC 8291 / RFC 8292) directement
   avec l'API Web Crypto native du runtime Workers — pas de dépendance
   npm, pas de module Node "https" (non disponible côté Workers).

   Routes :
     POST /subscribe    { subscription, targetName, wakeTimes[] }
     POST /unsubscribe  { subscription }

   Cron (chaque minute) : envoie une notification push à chaque abonné
   dont une heure de réveil stockée tombe dans la minute en cours.
*/

const SEND_WINDOW_MS = 90 * 1000; // marge anti-décalage de cron
const RETENTION_MS = 24 * 3600 * 1000; // nettoyage des heures passées
const MAX_WAKE_TIMES = 14;

/* ---------- Encodage ---------- */
function base64urlToBytes(base64url) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "==".slice(0, (4 - (base64.length % 4)) % 4);
  const raw = atob(padded);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function bytesToBase64url(bytes) {
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concatBytes(...arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

async function sha256Hex(str) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- VAPID (RFC 8292) — authentifie le serveur auprès du push service ---------- */
async function importVapidPrivateKey(privateKeyB64, publicKeyB64) {
  const pub = base64urlToBytes(publicKeyB64); // 0x04 || X(32) || Y(32)
  const d = base64urlToBytes(privateKeyB64); // scalaire privé, 32 octets
  const jwk = {
    kty: "EC",
    crv: "P-256",
    ext: true,
    x: bytesToBase64url(pub.slice(1, 33)),
    y: bytesToBase64url(pub.slice(33, 65)),
    d: bytesToBase64url(d),
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function buildVapidAuthHeader(endpoint, vapid) {
  const url = new URL(endpoint);
  const aud = `${url.protocol}//${url.host}`;
  const enc = (obj) => bytesToBase64url(new TextEncoder().encode(JSON.stringify(obj)));
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: vapid.subject,
  })}`;
  const key = await importVapidPrivateKey(vapid.privateKey, vapid.publicKey);
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(unsigned)
  );
  return `vapid t=${unsigned}.${bytesToBase64url(new Uint8Array(sig))}, k=${vapid.publicKey}`;
}

/* ---------- Chiffrement du contenu (RFC 8291 + RFC 8188 aes128gcm) ---------- */
async function hmacSha256(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, dataBytes));
}

async function hkdfExpand(prk, info, length) {
  const t1 = await hmacSha256(prk, concatBytes(info, new Uint8Array([1])));
  return t1.slice(0, length);
}

async function encryptPayload(payloadBytes, p256dhB64, authB64) {
  const uaPublic = base64urlToBytes(p256dhB64); // clé publique de l'abonné
  const authSecret = base64urlToBytes(authB64); // secret partagé, 16 octets

  const asKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", asKeyPair.publicKey));

  const uaPublicKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaPublicKey }, asKeyPair.privateKey, 256)
  );

  const keyInfo = concatBytes(new TextEncoder().encode("WebPush: info\0"), uaPublic, asPublicRaw);
  const prkKey = await hmacSha256(authSecret, ecdhSecret);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacSha256(salt, ikm);
  const cek = await hkdfExpand(prk, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);

  const paddedPlaintext = concatBytes(payloadBytes, new Uint8Array([2])); // delimiter RFC 8188, pas de padding
  const cekKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cekKey, paddedPlaintext)
  );

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  const header = concatBytes(salt, rs, new Uint8Array([asPublicRaw.length]), asPublicRaw);
  return concatBytes(header, ciphertext);
}

async function sendWebPush(subscription, payloadObj, vapid) {
  const body = await encryptPayload(new TextEncoder().encode(JSON.stringify(payloadObj)), subscription.keys.p256dh, subscription.keys.auth);
  const authHeader = await buildVapidAuthHeader(subscription.endpoint, vapid);
  return fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      TTL: "300",
      Authorization: authHeader,
    },
    body,
  });
}

/* ---------- HTTP ---------- */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Push-Secret",
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function isAuthorized(request, env) {
  return !env.PUSH_SECRET || request.headers.get("X-Push-Secret") === env.PUSH_SECRET;
}

function isValidSubscription(sub) {
  return Boolean(sub && typeof sub.endpoint === "string" && sub.keys && typeof sub.keys.p256dh === "string" && typeof sub.keys.auth === "string");
}

async function handleSubscribe(request, env) {
  if (!isAuthorized(request, env)) return json({ error: "forbidden" }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  if (!isValidSubscription(body.subscription)) return json({ error: "bad_subscription" }, 400);

  const wakeTimes = Array.isArray(body.wakeTimes)
    ? body.wakeTimes.filter((t) => !Number.isNaN(new Date(t).getTime())).slice(0, MAX_WAKE_TIMES)
    : [];
  const targetName = typeof body.targetName === "string" ? body.targetName.slice(0, 40) : "";

  const key = await sha256Hex(body.subscription.endpoint);
  const existingRaw = await env.SUBS.get(key);
  const existing = existingRaw ? JSON.parse(existingRaw) : null;

  await env.SUBS.put(
    key,
    JSON.stringify({
      subscription: body.subscription,
      targetName,
      wakeTimes,
      sent: existing ? existing.sent || [] : [],
    })
  );
  return json({ ok: true });
}

async function handleUnsubscribe(request, env) {
  if (!isAuthorized(request, env)) return json({ error: "forbidden" }, 403);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }
  if (!body.subscription || typeof body.subscription.endpoint !== "string") {
    return json({ error: "bad_subscription" }, 400);
  }
  await env.SUBS.delete(await sha256Hex(body.subscription.endpoint));
  return json({ ok: true });
}

/* ---------- Cron : envoie les notifications dues ---------- */
async function handleScheduled(env) {
  const vapid = {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT || "mailto:push@example.com",
  };
  const now = Date.now();

  let cursor;
  let listComplete = false;
  while (!listComplete) {
    const list = await env.SUBS.list(cursor ? { cursor } : {});
    for (const entry of list.keys) {
      const raw = await env.SUBS.get(entry.name);
      if (!raw) continue;
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        continue;
      }

      const due = (data.wakeTimes || []).filter((t) => {
        const ts = new Date(t).getTime();
        return ts <= now && ts > now - SEND_WINDOW_MS && !(data.sent || []).includes(t);
      });

      let gone = false;
      for (const t of due) {
        try {
          const res = await sendWebPush(
            data.subscription,
            { title: `Réveil — ${data.targetName || "Mon Planning"}`, body: "C'est l'heure de se réveiller !" },
            vapid
          );
          if (res.status === 404 || res.status === 410) {
            gone = true;
            break;
          }
          data.sent = [...(data.sent || []), t];
        } catch (err) {
          console.error("Échec d'envoi push", err);
        }
      }

      if (gone) {
        await env.SUBS.delete(entry.name);
        continue;
      }

      const cutoff = now - RETENTION_MS;
      data.wakeTimes = (data.wakeTimes || []).filter((t) => new Date(t).getTime() > cutoff);
      data.sent = (data.sent || []).filter((t) => new Date(t).getTime() > cutoff);
      await env.SUBS.put(entry.name, JSON.stringify(data));
    }
    listComplete = list.list_complete;
    cursor = list.cursor;
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/subscribe") return handleSubscribe(request, env);
    if (request.method === "POST" && url.pathname === "/unsubscribe") return handleUnsubscribe(request, env);
    return json({ error: "not_found" }, 404);
  },
  async scheduled(event, env) {
    await handleScheduled(env);
  },
};
