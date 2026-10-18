import { requireAdminPrincipal } from "@/lib/auth/authorization";
import ManualTestAdminClient from "./admin-client";

export const dynamic = "force-dynamic";

export default async function ManualTestAdminPage() {
  await requireAdminPrincipal();
  return <ManualTestAdminClient />;
}
