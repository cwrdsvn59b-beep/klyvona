/**
 * Server-only seal for future OAuth tokens. Nothing in the onboarding flow
 * calls this. The key never reaches the browser.
 */

const ALGO = "AES-GCM";

function keyMaterial(): Uint8Array<ArrayBuffer> | null {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw || !raw.trim()) return null;
  try {
    const bytes = Buffer.from(raw, "base64");
    if (bytes.length !== 32) return null;
    return new Uint8Array(bytes);
  } catch {
    return null;
  }
}

export function tokenStorageReady(): boolean {
  return keyMaterial() !== null;
}

async function importKey(usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  const material = keyMaterial();
  if (!material) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  return crypto.subtle.importKey("raw", material, ALGO, false, [usage]);
}

export async function sealSecret(plaintext: string): Promise<string> {
  const key = await importKey("encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const packed = new Uint8Array(iv.length + cipher.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(cipher), iv.length);
  return Buffer.from(packed).toString("base64");
}

export async function openSecret(packed: string): Promise<string> {
  const key = await importKey("decrypt");
  const bytes = Buffer.from(packed, "base64");
  const iv = bytes.subarray(0, 12);
  const cipher = bytes.subarray(12);
  const plain = await crypto.subtle.decrypt({ name: ALGO, iv }, key, cipher);
  return new TextDecoder().decode(plain);
}
