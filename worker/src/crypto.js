/* ==========================================================================
   Tuition Manager Worker — crypto.js
   Password hashing (PBKDF2-SHA256 via Web Crypto, available natively in
   the Workers runtime — no npm dependency needed) and random token/id
   generation. Passwords are never stored or logged in plaintext.
   ========================================================================== */

const PBKDF2_ITERATIONS = 100000;

function bufToHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes.buffer;
}

export function randomHex(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bufToHex(bytes.buffer);
}

export function newId() {
  return crypto.randomUUID();
}

export async function hashPassword(password) {
  const salt = randomHex(16);
  const hash = await pbkdf2(password, salt);
  return { hash, salt };
}

export async function verifyPassword(password, hash, salt) {
  const candidate = await pbkdf2(password, salt);
  return timingSafeEqual(candidate, hash);
}

async function pbkdf2(password, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: hexToBuf(saltHex),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return bufToHex(derived);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export function newSessionToken() {
  return randomHex(32);
}

/** SHA-256 of a string, returned as hex (used to store reset tokens safely). */
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return bufToHex(digest);
}

/* ---------------------------- recovery codes ---------------------------- */

// 32 characters with no look-alikes (no 0/O, 1/I). 32 divides 256, so picking
// a character from a random byte is perfectly unbiased.
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A new random recovery code like "K7QM-4TXP-92WD-HFN8" (16 characters = 80 bits). */
export function newRecoveryCode() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  bytes.forEach((b, i) => {
    if (i > 0 && i % 4 === 0) out += "-";
    out += RECOVERY_ALPHABET[b % 32];
  });
  return out;
}

/** Accepts the code however the user typed it (lower case, spaces, missing dashes) and returns the canonical 16 characters, or "" if it cannot be a code. */
export function normalizeRecoveryCode(input) {
  const clean = String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-HJ-NP-Z2-9]{16}$/.test(clean) ? clean : "";
}

/** Hash stored in the database. Includes the user id so two accounts never share a hash. */
export async function hashRecoveryCode(userId, normalizedCode) {
  return sha256Hex("recovery:" + userId + ":" + normalizedCode);
}

/** Compares two hex strings without stopping at the first difference. */
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
