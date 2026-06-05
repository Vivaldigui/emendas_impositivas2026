import type { NextRequest } from "next/server";

export type AdminUser = {
  id: string;
  nome: string;
};

export function getAuthorizedAdmin(request: NextRequest): AdminUser | null {
  const secret = process.env.COLETA_ADMIN_SECRET;

  if (!secret && process.env.NODE_ENV !== "production") {
    return {
      id: request.headers.get("x-admin-user") || "dev-admin",
      nome: request.headers.get("x-admin-user") || "Administrador local",
    };
  }

  const authorization = request.headers.get("authorization") ?? "";
  const tokenHeader = request.headers.get("x-admin-secret") ?? "";

  if (secret && (authorization === `Bearer ${secret}` || tokenHeader === secret)) {
    return {
      id: request.headers.get("x-admin-user") || "admin",
      nome: request.headers.get("x-admin-user") || "Administrador",
    };
  }

  return null;
}

export function isAuthorizedAdmin(request: NextRequest) {
  return Boolean(getAuthorizedAdmin(request));
}
