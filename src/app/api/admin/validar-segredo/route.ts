import { NextRequest, NextResponse } from "next/server";

import { getAdminAuthStatus, getAuthorizedAdmin } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const admin = getAuthorizedAdmin(request);

  if (!admin) {
    const auth = getAdminAuthStatus(request);
    return NextResponse.json(
      {
        ok: false,
        error: "Nao autorizado.",
        details: {
          adminSecretConfigurado: auth.configured,
          segredoEnviado: auth.provided,
        },
      },
      { status: 401 },
    );
  }

  return NextResponse.json({
    ok: true,
    admin,
  });
}
