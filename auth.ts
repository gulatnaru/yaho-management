import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authenticateOperator } from "@/lib/auth/credentials";
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
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    session: ({ session, token }) => {
      if (session.user) {
        if (typeof token.id === "string") {
          session.user.id = token.id;
        }
        if (token.role === "ADMIN" || token.role === "TEACHER") {
          session.user.role = token.role;
        }
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
});
