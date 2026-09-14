import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authenticateOperator } from "@/lib/auth/credentials";
import { writeJwtIdentity, writeSessionIdentity } from "@/lib/auth/session";
import { credentialsSchema } from "@/lib/validation/auth";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "이메일", type: "email" },
        password: { label: "비밀번호", type: "password" },
      },
      authorize: async (credentials) => {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }

        return authenticateOperator(parsed.data);
      },
    }),
  ],
  callbacks: {
    jwt: ({ token, user }) => {
      return writeJwtIdentity(token, user);
    },
    session: ({ session, token }) => {
      return writeSessionIdentity(session, token);
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
});
