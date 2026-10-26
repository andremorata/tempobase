/**
 * Auth.js v5 Configuration
 *
 * Provides credentials-based authentication with JWT sessions.
 */

import { createHash } from "node:crypto";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import * as bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";
import type { UserRole } from "@prisma/client";

type AppAuthUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  accountId: string;
};

type AppAuthToken = {
  id?: string;
  email?: string | null;
  firstName?: string;
  lastName?: string;
  role?: UserRole;
  accountId?: string;
  canViewAmounts?: boolean;
  /** Fingerprint of the password hash at sign-in; a password change invalidates the token */
  pwd?: string;
};

function passwordFingerprint(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("base64url").slice(0, 16);
}

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] &
      AppAuthUser & {
        emailVerified: Date | null;
        canViewAmounts: boolean;
      };
  }

  interface User extends AppAuthUser {
    emailVerified: Date | null;
  }
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  trustHost: true,
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email as string;
        const password = credentials.password as string;

        // Query user by email (bypass tenant filter). Oldest first, so a later
        // duplicate of the same email cannot shadow the original account.
        const user = await prisma.user.findFirst({
          where: {
            email: email.toLowerCase(),
            isActive: true,
            isDeleted: false,
          },
          orderBy: { createdAt: "asc" },
        });

        if (!user) {
          return null;
        }

        // Verify password
        const passwordMatch = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatch) {
          return null;
        }

        // Return user object for JWT
        return {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          accountId: user.accountId,
          emailVerified: null,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  callbacks: {
    async jwt({ token, user }) {
      const appToken = token as typeof token & AppAuthToken;

      if (user) {
        // Initial sign in
        appToken.id = (user as typeof user & AppAuthUser).id;
      }

      // Re-read the user on every request so removal, deactivation, role changes
      // and password changes take effect immediately instead of when the JWT expires.
      // NOTE: one primary-key query per auth() call; cache per request if it shows up in latency.
      const dbUser = appToken.id
        ? await prisma.user.findFirst({
            where: { id: appToken.id, isActive: true, isDeleted: false, account: { isDeleted: false } },
            select: {
              email: true,
              firstName: true,
              lastName: true,
              role: true,
              accountId: true,
              canViewAmounts: true,
              passwordHash: true,
            },
          })
        : null;

      if (!dbUser) return null;

      const pwd = passwordFingerprint(dbUser.passwordHash);
      if (user) {
        appToken.pwd = pwd;
      } else if (appToken.pwd !== pwd) {
        return null;
      }

      appToken.email = dbUser.email;
      appToken.firstName = dbUser.firstName;
      appToken.lastName = dbUser.lastName;
      appToken.role = dbUser.role;
      appToken.accountId = dbUser.accountId;
      appToken.canViewAmounts = dbUser.canViewAmounts;

      return token;
    },
    async session({ session, token }) {
      const appToken = token as typeof token & AppAuthToken;

      // Expose user fields in session
      session.user = {
        id: appToken.id ?? "",
        email: appToken.email ?? "",
        name: [appToken.firstName, appToken.lastName].filter(Boolean).join(" ") || null,
        image: null,
        firstName: appToken.firstName ?? "",
        lastName: appToken.lastName ?? "",
        role: appToken.role ?? "Member",
        accountId: appToken.accountId ?? "",
        canViewAmounts: appToken.canViewAmounts ?? false,
        emailVerified: null,
      };
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
