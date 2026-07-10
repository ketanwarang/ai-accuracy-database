import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "crypto";
import { createAdminClient } from "@/lib/supabaseAdmin";

const LOWER = "abcdefghjkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";
const DIGIT = "23456789";
const SYMBOL = "!@#$%^&*";
const ALL = LOWER + UPPER + DIGIT + SYMBOL;

function generateTempPassword(length = 14): string {
  const required = [LOWER, UPPER, DIGIT, SYMBOL].map(
    (set) => set[randomInt(set.length)]
  );
  const rest = Array.from({ length: length - required.length }, () => ALL[randomInt(ALL.length)]);
  const chars = [...required, ...rest];
  // Fisher-Yates shuffle so the required chars aren't always in the same positions
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export async function POST(req: NextRequest) {
  let email: string;
  try {
    const body = await req.json();
    email = String(body.email || "").trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!email) {
    return NextResponse.json({ error: "Enter your email." }, { status: 400 });
  }
  if (!email.endsWith("@paralleldots.com")) {
    return NextResponse.json({ error: "Only @paralleldots.com accounts are allowed." }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: roles, error: rolesError } = await supabase
    .from("user_roles")
    .select("id")
    .eq("user_email", email)
    .limit(1);

  if (rolesError) {
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
  if (!roles || roles.length === 0) {
    return NextResponse.json(
      { error: "no_access", message: "Your account hasn't been granted access yet. Contact ketan.warang@paralleldots.com." },
      { status: 403 }
    );
  }

  const tempPassword = generateTempPassword();

  const { error: createError } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { must_change_password: true },
  });

  if (createError) {
    const alreadyExists = /already.*registered|already.*exists/i.test(createError.message);
    if (alreadyExists) {
      return NextResponse.json(
        { error: "already_exists", message: "An account already exists for this email. Sign in, or use Forgot password if you don't remember it." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: createError.message }, { status: 500 });
  }

  return NextResponse.json({ tempPassword });
}
