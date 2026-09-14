export const ACCOUNT_MUTATION_ADVISORY_LOCK_KEY = 16_001_001;

export type AccountMutationLockClient = {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

/**
 * Account reset/change/update paths share one transaction-scoped lock. The
 * intentionally coarse lock keeps the rare credential mutations serial and
 * makes reset versus self-change ordering deterministic.
 */
export async function lockAccountMutations(client: AccountMutationLockClient): Promise<void> {
  await client.$queryRaw<Array<{ locked: number }>>`
    SELECT 1 AS "locked"
    FROM pg_advisory_xact_lock(${ACCOUNT_MUTATION_ADVISORY_LOCK_KEY})
  `;
}
