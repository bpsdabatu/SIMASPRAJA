import { b64urlDecode, b64urlEncode } from "./crypto";

/**
 * Enkripsi AES-256-GCM murni (Web Crypto) untuk kata sandi sementara; kunci diturunkan dari APP_SECRET.
 * Dipisah dari temp-credential.ts (yang "server-only") agar skrip pemulihan (npm run accounts:reset) memakai format yang sama.
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

async function key(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`${secret}:temp-credential:v1`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealTempPassword(secret: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), enc.encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return b64urlEncode(out);
}

export async function openTempPassword(secret: string, sealed: string): Promise<string | null> {
  try {
    const all = b64urlDecode(sealed);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) as BufferSource }, await key(secret), all.slice(12) as BufferSource);
    return dec.decode(pt);
  } catch { return null; }
}
