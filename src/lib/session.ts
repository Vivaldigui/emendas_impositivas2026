import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "admin_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas

export type AdminUser = {
  id: string;
  nome: string;
};

type SessionPayload = {
  sub: string;
  nome: string;
  exp: number;
};

function getSessionSecret(): string {
  return (
    process.env.SESSION_SECRET?.trim() ||
    process.env.COLETA_ADMIN_SECRET?.trim() ||
    (process.env.NODE_ENV !== "production" ? "dev-session-secret" : "")
  );
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function sign(payloadB64: string, secret: string): string {
  return base64url(createHmac("sha256", secret).update(payloadB64).digest());
}

export function createSessionToken(user: AdminUser): string {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error("SESSION_SECRET nao configurado.");
  }
  const payload: SessionPayload = {
    sub: user.id,
    nome: user.nome,
    exp: Date.now() + SESSION_TTL_MS,
  };
  const payloadB64 = base64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

export function verifySessionToken(token: string | undefined | null): AdminUser | null {
  if (!token) return null;
  const secret = getSessionSecret();
  if (!secret) return null;

  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return null;

  const expected = sign(payloadB64, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64url(payloadB64).toString("utf8")) as SessionPayload;
    if (!payload.exp || payload.exp < Date.now()) {
      return null;
    }
    return { id: payload.sub, nome: payload.nome };
  } catch {
    return null;
  }
}

type AdminCredential = { usuario: string; senha: string; nome?: string };

function parseAdminUsers(): AdminCredential[] {
  const raw = process.env.ADMIN_USERS?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is AdminCredential =>
          item &&
          typeof item.usuario === "string" &&
          typeof item.senha === "string",
      )
      .map((item) => ({
        usuario: item.usuario.trim(),
        senha: item.senha,
        nome: item.nome?.trim() || item.usuario.trim(),
      }));
  } catch {
    return [];
  }
}

function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Valida usuário+senha. Usa ADMIN_USERS (JSON) quando configurado.
 * Transição: se ADMIN_USERS não estiver configurado mas COLETA_ADMIN_SECRET
 * existir, aceita qualquer usuário cuja senha seja igual ao COLETA_ADMIN_SECRET.
 */
export function authenticate(usuario: string, senha: string): AdminUser | null {
  const login = usuario.trim();
  if (!login || !senha) return null;

  const users = parseAdminUsers();

  if (users.length > 0) {
    const match = users.find((user) => user.usuario === login);
    if (match && safeEquals(senha, match.senha)) {
      return { id: match.usuario, nome: match.nome ?? match.usuario };
    }
    return null;
  }

  const legacySecret = process.env.COLETA_ADMIN_SECRET?.trim();
  if (legacySecret && safeEquals(senha, legacySecret)) {
    return { id: login, nome: login };
  }

  if (process.env.NODE_ENV !== "production" && senha === "dev") {
    return { id: login, nome: login };
  }

  return null;
}

export function sessionCookieOptions(maxAgeSeconds = SESSION_TTL_MS / 1000) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
