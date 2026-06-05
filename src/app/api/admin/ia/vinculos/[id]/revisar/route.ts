import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getAuthorizedAdmin } from "@/lib/adminAuth";
import { revisarVinculo } from "@/services/aiEmpenhoLinker";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  acao: z.enum(["CONFIRMAR", "REJEITAR", "ALTERAR_VALOR", "DESFAZER_CONFIRMACAO"]),
  valorAtribuido: z.number().nonnegative().nullable().optional(),
  justificativa: z.string().trim().min(1).nullable().optional(),
  permitirExcedente: z.boolean().optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const admin = getAuthorizedAdmin(request);

  if (!admin) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const { id } = await context.params;
  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Corpo da requisicao invalido.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const vinculo = await revisarVinculo({
      vinculoId: id,
      acao: parsed.data.acao,
      valorAtribuido: parsed.data.valorAtribuido,
      justificativa: parsed.data.justificativa,
      permitirExcedente: parsed.data.permitirExcedente,
      revisadoPor: admin.id,
    });

    return NextResponse.json({ vinculo });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao revisar vinculo." },
      { status: 400 },
    );
  }
}
