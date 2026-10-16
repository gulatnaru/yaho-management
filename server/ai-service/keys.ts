import { z } from "zod";
import { validateKeys, type Keys } from "./crypto";
import { ServiceDenied } from "./contracts";
const versions = z.record(z.string().regex(/^v[1-9][0-9]{0,3}$/), z.string().regex(/^[A-Za-z0-9+/]{43}=$/));
/** Separate from Mock keys. Rotation must retain all ledger-pinned HMAC versions. */
export function readServiceKeys(env: NodeJS.ProcessEnv): Keys {
    try {
        const encryption = versions.parse(JSON.parse(env.AI_SERVICE_ENCRYPTION_KEYS ?? "null"));
        const hmac = versions.parse(JSON.parse(env.AI_SERVICE_HMAC_KEYS ?? "null"));
        const keys = { encryption: Object.fromEntries(Object.entries(encryption).map(([v, k]) => [v, Buffer.from(k, "base64")])),
            hmac: Object.fromEntries(Object.entries(hmac).map(([v, k]) => [v, Buffer.from(k, "base64")])),
            activeEncryption: env.AI_SERVICE_ENCRYPTION_ACTIVE ?? "", activeHmac: env.AI_SERVICE_HMAC_ACTIVE ?? "" };
        validateKeys(keys);
        return keys;
    }
    catch {
        throw new ServiceDenied();
    }
}
