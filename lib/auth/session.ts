import type { Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";

type AuthenticatedUserIdentity = Pick<User, "id" | "authVersion">;

/**
 * Persist only immutable identity plus the credential version in the JWT.
 * Role and active state are deliberately excluded because authorization must
 * use the current database row on every protected request.
 */
export function writeJwtIdentity(
  token: JWT,
  user?: AuthenticatedUserIdentity,
): JWT {
  delete token.id;
  delete token.role;
  delete token.isActive;
  delete token.teacherId;
  delete token.mustChangePassword;

  if (user && typeof user.id === "string" && Number.isSafeInteger(user.authVersion)) {
    token.userId = user.id;
    token.authVersion = user.authVersion;
  }

  return token;
}

/**
 * The browser-visible session contains no authorization decision. Consumers
 * that need a role must resolve a live CurrentPrincipal on the server.
 */
export function writeSessionIdentity(session: Session, token: JWT): Session {
  if (!session.user) {
    return session;
  }

  const user = session.user as typeof session.user & Record<string, unknown>;
  delete user.role;
  delete user.isActive;
  delete user.teacherId;
  delete user.mustChangePassword;

  if (typeof token.userId === "string") {
    session.user.id = token.userId;
  }
  const authVersion = token.authVersion;
  if (typeof authVersion === "number" && Number.isSafeInteger(authVersion) && authVersion >= 1) {
    session.user.authVersion = authVersion;
  }

  return session;
}
