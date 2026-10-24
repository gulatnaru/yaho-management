import { createHmac, createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ServiceDenied, RETENTION_MS, recordSchema, type Environment } from "./contracts";
export type Keys = {
    encryption: Record<string, Buffer>;
    hmac: Record<string, Buffer>;
    activeEncryption: string;
    activeHmac: string;
};
export type Binding = {
    id: string;
    environment: Environment;
    createdAt: Date;
    expiresAt: Date;
};
export function validateKeys(keys: Keys) {
    const all = [...Object.values(keys.encryption), ...Object.values(keys.hmac)];
    if (!keys.encryption[keys.activeEncryption] || !keys.hmac[keys.activeHmac] || !all.length || all.length > 16 ||
        Object.keys(keys.encryption).concat(Object.keys(keys.hmac)).some(v => !/^v[1-9][0-9]{0,3}$/.test(v)) ||
        all.some(k => k.length !== 32) || new Set(all.map(k => k.toString("hex"))).size !== all.length)
        throw new ServiceDenied();
}
export function hashes(keys: Keys, purpose: string, environment: Environment, value: string) {
    validateKeys(keys);
    return Object.keys(keys.hmac).sort((a, b) => a === keys.activeHmac ? -1 : b === keys.activeHmac ? 1 : a.localeCompare(b)).map(v => v + ":" + createHmac("sha256", keys.hmac[v]).update(JSON.stringify([purpose, environment, value])).digest("hex"));
}
export function rawDigest(raw: string) { return createHash("sha256").update(raw).digest("hex"); }
function aad(binding: Binding, version: string) {
    if (binding.expiresAt.getTime() - binding.createdAt.getTime() !== RETENTION_MS)
        throw new ServiceDenied();
    return Buffer.from(JSON.stringify([binding.id, binding.environment, binding.createdAt.toISOString(), binding.expiresAt.toISOString(), version]));
}
export function encrypt(keys: Keys, binding: Binding, record: unknown) {
    validateKeys(keys);
    const data = recordSchema.safeParse(record);
    if (!data.success)
        throw new ServiceDenied();
    const version = keys.activeEncryption, iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", keys.encryption[version], iv);
    cipher.setAAD(aad(binding, version));
    const bytes = Buffer.concat([cipher.update(JSON.stringify(data.data)), cipher.final()]);
    return { encryptionVersion: version, rawCiphertext: JSON.stringify([version, iv.toString("base64"), cipher.getAuthTag().toString("base64"), bytes.toString("base64")]) };
}
export function decrypt(keys: Keys, binding: Binding, text: string, clock: () => Date = () => new Date()) {
    try {
        validateKeys(keys);
        if (binding.expiresAt <= clock())
            throw new ServiceDenied();
        const encoded: unknown = JSON.parse(text);
        if (!Array.isArray(encoded) || encoded.length !== 4 || encoded.some(v => typeof v !== "string") || text.length > 20000)
            throw new ServiceDenied();
        const [version, iv, tag, body] = encoded as string[];
        const key = keys.encryption[version];
        if (!key || Buffer.from(iv, "base64").length !== 12 || Buffer.from(tag, "base64").length !== 16)
            throw new ServiceDenied();
        const cipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
        cipher.setAAD(aad(binding, version));
        cipher.setAuthTag(Buffer.from(tag, "base64"));
        const value = recordSchema.parse(JSON.parse(Buffer.concat([cipher.update(Buffer.from(body, "base64")), cipher.final()]).toString("utf8")));
        if (binding.expiresAt <= clock())
            throw new ServiceDenied();
        return value;
    }
    catch {
        throw new ServiceDenied();
    }
}
export type HmacPin = {
    version: string;
    fingerprint: string;
};
export function hmacPins(keys: Keys, environment: Environment): HmacPin[] {
    validateKeys(keys);
    return Object.keys(keys.hmac).sort().map(version => ({ version,
        fingerprint: createHmac("sha256", keys.hmac[version]).update(JSON.stringify(["ai-service-key-pin-v1", environment, version])).digest("hex") }));
}
