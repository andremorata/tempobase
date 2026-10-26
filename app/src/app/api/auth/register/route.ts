/**
 * Registration Endpoint
 *
 * Creates new account + owner user.
 * POST /api/auth/register
 */

import { NextRequest, NextResponse } from "next/server";
import * as bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  accountName: z.string().min(1).max(200),
});

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = RegisterSchema.parse(body);

    const emailLower = validated.email.toLowerCase();

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        email: emailLower,
        isDeleted: false,
      },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 }
      );
    }

    // Hash password
    const passwordHash = await bcrypt.hash(validated.password, 10);

    // Generate unique slug
    let slug = slugify(validated.accountName);
    let slugCounter = 1;
    while (
      await prisma.account.findUnique({
        where: { slug },
      })
    ) {
      slug = `${slugify(validated.accountName)}-${slugCounter}`;
      slugCounter++;
    }

    // Create account + owner user in transaction
    const result = await prisma.$transaction(async (tx) => {
      const account = await tx.account.create({
        data: {
          name: validated.accountName.trim(),
          slug,
          timezone: "UTC",
          currency: "USD",
          auditRetentionDays: 365,
        },
      });

      const user = await tx.user.create({
        data: {
          accountId: account.id,
          email: emailLower,
          firstName: validated.firstName.trim(),
          lastName: validated.lastName.trim(),
          passwordHash,
          role: "Owner",
          isActive: true,
        },
      });

      return { account, user };
    });

    return NextResponse.json(
      {
        message: "Registration successful",
        userId: result.user.id,
        accountId: result.account.id,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.issues },
        { status: 400 }
      );
    }

    // A concurrent registration with the same email hit the unique index
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 }
      );
    }

    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Registration failed" },
      { status: 500 }
    );
  }
}
