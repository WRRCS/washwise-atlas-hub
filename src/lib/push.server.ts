// Server-only Web Push sender built on Web Crypto (RFC 8291 aes128gcm + RFC 8292 VAPID).
// The `web-push` npm package breaks on the Worker runtime ("buffer.hasOwnProperty is not a function").
// Import only from *.functions.ts handlers or server routes; never from client components.

export type PushPayload = { title: string; body: string; url?: string; tag?: string };
export type PushTarget = { endpoint: string; p256dh: string; auth: string };

type Bytes = Uint8Array<ArrayBuffer>;
const enc = new TextEncoder();

function b64uDecode(s: string): Bytes {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64uEncode(buf: ArrayBuffer | Bytes): string {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concat(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, len: number) {
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, concat(info, new Uint8Array([1])));
  return okm.slice(0, len);
}

async function vapidAuthHeader(endpoint: string): Promise<string> {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const sub = process.env.VAPID_SUBJECT || "mailto:info@washrinserepeatcleaning.com";
  if (!pub || !priv) throw new Error("VAPID keys not configured");
  const pubBytes = b64uDecode(pub);
  const jwk: JsonWebKey = {
    kty: "EC", crv: "P-256",
    x: b64uEncode(pubBytes.slice(1, 33)),
    y: b64uEncode(pubBytes.slice(33, 65)),
    d: priv.replace(/=+$/, ""),
  };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64uEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64uEncode(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub,
  })));
  const unsigned = `${header}.${claims}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64uEncode(sig)}, k=${pub.replace(/=+$/, "")}`;
}

async function encrypt(target: PushTarget, plaintext: Bytes): Promise<Bytes> {
  const uaPub = b64uDecode(target.p256dh);
  const authSecret = b64uDecode(target.auth);
  const local = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const padded = concat(plaintext, new Uint8Array([2])); // last-record delimiter
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, padded));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, cipher);
}

/**
 * Sends a push to a single subscription. Returns "sent" on 2xx,
 * "gone" when the subscription expired (404/410); throws otherwise.
 */
export async function sendWebPush(target: PushTarget, payload: PushPayload): Promise<"sent" | "gone"> {
  const body = await encrypt(target, enc.encode(JSON.stringify(payload)));
  const res = await fetch(target.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthHeader(target.endpoint),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(60 * 60 * 24),
      Urgency: "normal",
    },
    body,
  });
  if (res.status === 404 || res.status === 410) return "gone";
  if (!res.ok) throw new Error(`Push failed: ${res.status} ${await res.text().catch(() => "")}`);
  return "sent";
}
