import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { AiDenied, RETENTION_MS } from "./contracts";
const version = z.string().regex(/^v[1-9][0-9]{0,3}$/);
const ring = z
  .record(version, z.string().regex(/^[A-Za-z0-9+/]{43}=$/))
  .refine((x) => Object.keys(x).length > 0 && Object.keys(x).length <= 8);
export type Keyring = {
  activeEncryption: string;
  activeHmac: string;
  encryption: Record<string, Buffer>;
  hmac: Record<string, Buffer>;
  auth: Buffer;
};
export function readKeys(env: NodeJS.ProcessEnv): Keyring {
  try {
    const enc = ring.parse(JSON.parse(env.AI_ENCRYPTION_KEYS ?? "null"));
    const mac = ring.parse(JSON.parse(env.AI_HMAC_KEYS ?? "null"));
    const activeEncryption = version.parse(env.AI_ENCRYPTION_ACTIVE);
    const activeHmac = version.parse(env.AI_HMAC_ACTIVE);
    const auth = Buffer.from(
      z
        .string()
        .regex(/^[A-Za-z0-9+/]{43}=$/)
        .parse(env.AI_MOCK_REQUEST_SECRET),
      "base64",
    );
    const encryption = Object.fromEntries(
      Object.entries(enc).map(([v, k]) => [v, Buffer.from(k, "base64")]),
    );
    const hmac = Object.fromEntries(
      Object.entries(mac).map(([v, k]) => [v, Buffer.from(k, "base64")]),
    );
    const keys = [...Object.values(encryption), ...Object.values(hmac), auth];
    if (
      !encryption[activeEncryption] ||
      !hmac[activeHmac] ||
      keys.some((k) => k.length !== 32) ||
      new Set(keys.map((k) => k.toString("hex"))).size !== keys.length
    )
      throw new AiDenied();
    return { activeEncryption, activeHmac, encryption, hmac, auth };
  } catch {
    throw new AiDenied();
  }
}
export function keyedHash(
  keys: Keyring,
  v: string,
  purpose: string,
  value: string,
) {
  const key = keys.hmac[v];
  if (!key) throw new AiDenied();
  return createHmac("sha256", key)
    .update(JSON.stringify([purpose, value]))
    .digest("hex");
}
export function subjectHashes(keys: Keyring, runId: string, subject: string) {
  return Object.keys(keys.hmac)
    .sort()
    .map(
      (v) =>
        v +
        ":" +
        keyedHash(keys, v, "subject", JSON.stringify([runId, subject])),
    );
}
export function equalHash(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export type Binding = {
  id: string;
  runId: string;
  createdAt: Date;
  expiresAt: Date;
};
function aad(b: Binding, v: string) {
  if (b.expiresAt.getTime() - b.createdAt.getTime() !== RETENTION_MS)
    throw new AiDenied();
  return Buffer.from(
    JSON.stringify([
      b.id,
      b.runId,
      b.createdAt.toISOString(),
      b.expiresAt.toISOString(),
      v,
    ]),
  );
}
export function seal(keys: Keyring, b: Binding, raw: unknown) {
  const v = keys.activeEncryption;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keys.encryption[v], iv);
  c.setAAD(aad(b, v));
  const encrypted = Buffer.concat([
    c.update(JSON.stringify(raw), "utf8"),
    c.final(),
  ]);
  return {
    encryptionVersion: v,
    rawCiphertext: JSON.stringify([
      v,
      iv.toString("base64"),
      c.getAuthTag().toString("base64"),
      encrypted.toString("base64"),
    ]),
  };
}
export function open(
  keys: Keyring,
  b: Binding,
  ciphertext: string,
  clock: () => Date = () => new Date(),
): unknown {
  try {
    if (b.expiresAt <= clock()) throw new AiDenied();
    const [v, iv, tag, data] = z
      .tuple([
        version,
        z.string().max(32),
        z.string().max(32),
        z.string().max(24000),
      ])
      .parse(JSON.parse(ciphertext));
    const key = keys.encryption[v];
    if (!key) throw new AiDenied();
    const ivBytes = Buffer.from(iv, "base64"),
      tagBytes = Buffer.from(tag, "base64");
    if (ivBytes.length !== 12 || tagBytes.length !== 16) throw new AiDenied();
    const d = createDecipheriv("aes-256-gcm", key, ivBytes);
    d.setAAD(aad(b, v));
    d.setAuthTag(tagBytes);
    const text = Buffer.concat([
      d.update(Buffer.from(data, "base64")),
      d.final(),
    ]).toString("utf8");
    if (b.expiresAt <= clock()) throw new AiDenied();
    return JSON.parse(text);
  } catch {
    throw new AiDenied();
  }
}
