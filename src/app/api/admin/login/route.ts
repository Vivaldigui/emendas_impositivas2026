import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  SESSION_COOKIE,
  authenticate,
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/session";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  usuario: z.string().min(1),
  senha: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Informe usuário e senha." },
      { status: 400 },
    );
  }

  const user = authenticate(parsed.data.usuario, parsed.data.senha);

  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Usuário ou senha inválidos." },
      { status: 401 },
    );
  }

  const token = createSessionToken(user);
  const response = NextResponse.json({ ok: true, admin: { id: user.id, nome: user.nome } });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}
