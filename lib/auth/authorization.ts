import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/auth/roles";

export { isAdmin } from "@/lib/auth/roles";

export async function requireAdmin() {
  const session = await auth();
  if (!isAdmin(session?.user)) {
    redirect("/login");
  }
  return session!;
}
