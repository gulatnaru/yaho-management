import { createHash } from "node:crypto";
export type ProgramSource = {
    id: string;
    name: string;
    description: string | null;
    status: string;
};
export type ClassSource = {
    id: string;
    programId: string;
    startsAt: Date;
    endsAt: Date;
    location: string;
    status: string;
};
/** Only fields eligible for approved public output; no capacity, count, customer or memo. */
export function programDigest(r: ProgramSource) { return createHash("sha256").update(JSON.stringify([r.id, r.name, r.description, r.status])).digest("hex"); }
export function classDigest(r: ClassSource) { return createHash("sha256").update(JSON.stringify([r.id, r.programId, r.startsAt.toISOString(), r.endsAt.toISOString(), r.location, r.status])).digest("hex"); }
