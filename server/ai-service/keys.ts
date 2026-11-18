import { z } from "zod";
import { validateKeys, type Keys } from "./crypto";
import { ServiceDenied } from "./contracts";
import { SkillDiagCode as C, SkillDiagDenied } from "./skill-diag";
const versions = z.record(z.string().regex(/^v[1-9][0-9]{0,3}$/), z.string().regex(/^[A-Za-z0-9+/]{43}=$/));
/** Separate from Mock keys. Rotation must retain all ledger-pinned HMAC versions. */
export function readServiceKeys(env: NodeJS.ProcessEnv): Keys {
    try {
        let encryption: Record<string, string>;
        let hmac: Record<string, string>;
        try { encryption = versions.parse(JSON.parse(env.AI_SERVICE_ENCRYPTION_KEYS ?? "null")); }
        catch (error) { if (error instanceof SyntaxError || error instanceof z.ZodError) throw new SkillDiagDenied(C.S8B_KEYS_ENC_PARSE); throw error; }
        try { hmac = versions.parse(JSON.parse(env.AI_SERVICE_HMAC_KEYS ?? "null")); }
        catch (error) { if (error instanceof SyntaxError || error instanceof z.ZodError) throw new SkillDiagDenied(C.S8B_KEYS_HMAC_PARSE); throw error; }
        const keys = { encryption: Object.fromEntries(Object.entries(encryption).map(([v, k]) => [v, Buffer.from(k, "base64")])),
            hmac: Object.fromEntries(Object.entries(hmac).map(([v, k]) => [v, Buffer.from(k, "base64")])),
            activeEncryption: env.AI_SERVICE_ENCRYPTION_ACTIVE ?? "", activeHmac: env.AI_SERVICE_HMAC_ACTIVE ?? "" };
        try { validateKeys(keys); } catch (error) { if (error instanceof ServiceDenied) throw new SkillDiagDenied(C.S8B_KEYS_VALIDATE); throw error; }
        return keys;
    }
    catch (error) {
        if (error instanceof SkillDiagDenied) throw error;
        throw new SkillDiagDenied(C.S0_UNKNOWN);
    }
}
