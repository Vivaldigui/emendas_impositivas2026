import { readFile, unlink } from "node:fs/promises";
import path from "node:path";

import {
  chromium,
  type Browser,
  type Download,
  type Page,
  type Response,
} from "playwright";

import { parseEmpenhosFile } from "@/collectors/sonner/empenhosParser";
import {
  EMPENHOS_SOURCE,
  appendColetaLog,
  detectEmpenhosExtension,
  ensureEmpenhosStorageDir,
  looksLikeErrorPayload,
  saveEmpenhosArtifact,
} from "@/services/empenhosStorage";
import type { ColetaLogEntry } from "@/lib/types";

export const PORTAL_CIDADAO_URL =
  "https://sistema.itanhandu.mg.gov.br/portalcidadao/";

export const PORTAL_ANALITICO_EMPENHOS_URL =
  "https://sistema.itanhandu.mg.gov.br/portalcidadao/#7cdbac9d6b970bcac1eb7182601bbdd39ce81c1e7a425f395f02db2441891e65003360a585fa4bc53a4c1109e77abd4737eb89513b9081883439ea9aaabe7971f7b93aa6fdd%C4%B0eaf32705452dbba2ca029ec4158a935811d1311d5f918c6535fab24431121f7375ce97a08ff8160720437142e661473c0dca19c6ee5b54dd5dc04fcdc70c20891f4960b78b05c50aa18f078483309517d0855bb7be16048cdebe52cda38079400fdfdfc95363bbb2281eebe4887ed60f254be621d226c79fe3005569fdaad720a5eda3c862441fe6a445f944ea51f5817582d1bf559dee1967cb6042faaedddaba0ab3431ef361af7acf7f24295b14c375ed0efb8692de05b40195d07ac04391b55974cf4222087e945afa88789e133b2109dcaaa6391df8";

type PlaywrightInput = {
  inicio: string;
  fim: string;
  formato: "excel" | "xls" | "xlsx" | "html" | "pdf" | "txt";
  headless?: boolean;
  fallbackReason?: string | null;
};

type CapturedFile = {
  kind: "download" | "response" | "popup";
  buffer: Buffer;
  contentType: string | null;
  endpoint: string | null;
};

export async function coletarEmpenhosComPlaywright(input: PlaywrightInput) {
  let browser: Browser | null = null;
  const etapas: ColetaLogEntry[] = [];

  try {
    browser = await chromium.launch({
      headless: input.headless ?? true,
      slowMo: input.headless === false ? 100 : 0,
    });
    const page = await browser.newPage({
      acceptDownloads: true,
      viewport: { width: 1365, height: 900 },
    });
    await page.addInitScript("window.__name = function(target) { return target; };");

    etapas.push(logStep("SUCESSO", "playwright.iniciar", "Abrindo Portal Cidadao publico."));
    await acessarTelaAnaliticoEmpenhos(page);
    etapas.push(
      logStep(
        "SUCESSO",
        "playwright.tela",
        "Tela de Analitico de Empenhos carregada ou rota publica acessada.",
      ),
    );

    await preencherFiltrosEmpenhos(page, input);
    etapas.push(
      logStep(
        "SUCESSO",
        "playwright.filtros",
        `Filtros aplicados: ${input.inicio} a ${input.fim}, formato ${input.formato}.`,
      ),
    );

    const capturePromise = waitForReportCapture(page);
    await clickGerar(page);
    const captured = await capturePromise;
    etapas.push(
      logStep(
        "SUCESSO",
        "playwright.captura",
        `Arquivo capturado via ${captured.kind}.`,
        { endpoint: captured.endpoint },
      ),
    );

    const extension = detectEmpenhosExtension({
      buffer: captured.buffer,
      contentType: captured.contentType,
      requestedFormat: input.formato,
    });
    const hashPreview = null;
    const parsed = parseEmpenhosFile({
      buffer: captured.buffer,
      extension,
      contentType: captured.contentType,
      hashArquivo: hashPreview,
      fonte: EMPENHOS_SOURCE,
    });
    const artifact = await saveEmpenhosArtifact({
      buffer: captured.buffer,
      inicio: input.inicio,
      fim: input.fim,
      formato: input.formato,
      endpoint: captured.endpoint,
      parametrosJson: buildPublicFilterMetadata(input),
      contentType: captured.contentType,
      registrosBrutos: parsed.rows.length,
      registros: parsed.registros,
      warnings: [
        ...parsed.warnings,
        ...(input.fallbackReason ? [`Fallback acionado: ${input.fallbackReason}`] : []),
      ],
      status: parsed.warnings.length ? "PARCIAL" : "SUCESSO",
    });

    return {
      ok: artifact.status !== "ERRO",
      status: artifact.status,
      mensagem:
        artifact.status === "SUCESSO"
          ? "Relatorio de empenhos coletado e importado."
          : "Relatorio de empenhos salvo com avisos.",
      artifact,
      etapas,
      erro: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    etapas.push(logStep("ERRO", "playwright.erro", message));
    await appendColetaLog({
      timestamp: new Date().toISOString(),
      status: "ERRO",
      etapa: "playwright.erro",
      mensagem: "Falha na coleta Playwright de empenhos.",
      erro: message,
    });
    return {
      ok: false,
      status: "ERRO" as const,
      mensagem: "Falha na coleta Playwright.",
      artifact: null,
      etapas,
      erro: message,
    };
  } finally {
    if (input.headless === false && browser) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }

    await browser?.close();
  }
}

async function acessarTelaAnaliticoEmpenhos(page: Page) {
  await page.goto(PORTAL_ANALITICO_EMPENHOS_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForLoadState("load", { timeout: 60000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => undefined);
  await page.waitForTimeout(2500);

  if (await bodyContains(page, ["Analitico de Empenhos", "Analítico de Empenhos"])) {
    return;
  }

  await page.goto(PORTAL_CIDADAO_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => undefined);
  await clickFirstVisibleText(page, ["Transparencia", "Transparência"], 110);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  await clickFirstVisibleText(page, ["Compras"], 260);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => undefined);
  await clickFirstVisibleText(
    page,
    ["Analitico de Empenhos", "Analítico de Empenhos"],
    340,
  );
  await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => undefined);
  await page.waitForTimeout(2500);

  if (!(await bodyContains(page, ["Analitico de Empenhos", "Analítico de Empenhos"]))) {
    throw new Error(
      "Nao foi possivel abrir a tela publica de Analitico de Empenhos pelo Portal Cidadao.",
    );
  }
}

async function preencherFiltrosEmpenhos(page: Page, input: PlaywrightInput) {
  await selectByVisibleOption(page, ["2026"], 0);
  await selectFormato(page, input.formato);
  await fillDateInputs(page, input.inicio, input.fim);
  await chooseRadioByLabel(page, ["Por Periodo", "Por Período"]);
  await chooseRadioByLabel(page, ["Empenho"]);
  await chooseRadioByLabel(page, ["Sem quebra"]);
  await checkByLabel(page, ["Todos os Empenhos"], true);
  await checkByLabel(page, ["Listar Empenhos por Historico", "Listar Empenhos por Histórico"], true);
  await checkByLabel(page, ["Ocultar Empenhos Anulados"], true);
  await checkByLabel(page, ["Listar Sub-Empenhos"], true);
  await checkByLabel(page, ["Listar Documentos de Pagamentos"], true);
  await checkByLabel(page, ["Listar Processo Compra dos Empenhos"], true);
  await chooseRadioByLabel(page, ["Todos"]);
}

async function waitForReportCapture(page: Page): Promise<CapturedFile> {
  const responsePromise = page
    .waitForResponse(
      (response) =>
        isReportResponse(response) || response.url().includes("downloadEncrypted"),
      { timeout: 90000 },
    )
    .then((response) => readResponse(page, response));
  const downloadPromise = page
    .waitForEvent("download", { timeout: 90000 })
    .then((download) => readDownload(download));
  const popupPromise = page
    .waitForEvent("popup", { timeout: 90000 })
    .then((popup) => readPopup(page, popup));

  try {
    return await Promise.any([responsePromise, downloadPromise, popupPromise]);
  } catch {
    throw new Error("Playwright nao conseguiu capturar arquivo, resposta ou popup do relatorio.");
  }
}

function isReportResponse(response: Response) {
  const url = response.url().toLowerCase();
  return (
    response.request().method() === "PUT" &&
    url.includes("/webservices/") &&
    (url.includes("relatorio") ||
      url.includes("relatorios") ||
      url.includes("empenho") ||
      url.includes("imprimir"))
  );
}

async function readResponse(page: Page, response: Response): Promise<CapturedFile> {
  const buffer = await response.body();
  const contentType = response.headers()["content-type"] ?? null;

  if (!response.ok()) {
    throw new Error(`Endpoint retornou HTTP ${response.status()}.`);
  }

  if (looksLikeErrorPayload(buffer, contentType)) {
    const json = tryParseJson(buffer);

    if (json && typeof json.val0 === "string" && json.val0) {
      const downloadUrl =
        "https://sistema.itanhandu.mg.gov.br/GRP/servlets/portalcidadao/cadastrosgerais/downloadEncrypted?id=" +
        json.val0;
      const fileResponse = await page.context().request.get(downloadUrl, {
        timeout: 60000,
      });

      return {
        kind: "response",
        buffer: await fileResponse.body(),
        contentType: fileResponse.headers()["content-type"] ?? null,
        endpoint: downloadUrl,
      };
    }

    throw new Error(`Endpoint retornou JSON sem arquivo: ${buffer.toString("utf8").slice(0, 500)}`);
  }

  return {
    kind: "response",
    buffer,
    contentType,
    endpoint: response.url(),
  };
}

async function readDownload(download: Download): Promise<CapturedFile> {
  const storageDir = await ensureEmpenhosStorageDir();
  const tempPath = path.join(storageDir, `playwright-${Date.now()}.tmp`);
  await download.saveAs(tempPath);
  const buffer = await readFile(tempPath);
  await unlink(tempPath).catch(() => undefined);

  return {
    kind: "download",
    buffer,
    contentType: null,
    endpoint: null,
  };
}

async function readPopup(parentPage: Page, popup: Page): Promise<CapturedFile> {
  await popup.waitForLoadState("load", { timeout: 30000 }).catch(() => undefined);
  const url = popup.url();

  if (!url || url === "about:blank" || url.startsWith("blob:")) {
    throw new Error("Popup capturado sem URL de download.");
  }

  const response = await parentPage.context().request.get(url, { timeout: 60000 });

  if (!response.ok()) {
    throw new Error(`Download por popup retornou HTTP ${response.status()}.`);
  }

  return {
    kind: "popup",
    buffer: await response.body(),
    contentType: response.headers()["content-type"] ?? null,
    endpoint: url,
  };
}

async function clickGerar(page: Page) {
  const button = page.getByRole("button", { name: /Gerar|Visualizar/i }).first();

  if ((await button.count()) && (await button.isVisible().catch(() => false))) {
    await button.click();
    return;
  }

  await clickFirstVisibleText(page, ["Gerar", "Visualizar"], 20);
}

async function selectFormato(page: Page, formato: string) {
  const labels =
    formato === "html"
      ? [".html", "html", "Hypertext"]
      : formato === "pdf"
        ? [".pdf", "PDF"]
        : [".xlsx", ".xls", "Excel", "Microsoft Excel"];

  await selectByVisibleOption(page, labels, 1);
}

async function selectByVisibleOption(
  page: Page,
  labels: string[],
  fallbackSelectIndex: number,
) {
  const normalizedLabels = labels.map(normalizeForMatch);

  for (const frame of frames(page)) {
    const selected = await frame
      .evaluate(
        ({ labels: candidateLabels, fallbackSelectIndex: index }) => {
          const normalize = (value: string | null | undefined) =>
            (value ?? "")
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase()
              .replace(/\s+/g, " ")
              .trim();
          const selects = Array.from(document.querySelectorAll("select")).filter((select) => {
            const box = select.getBoundingClientRect();
            const style = getComputedStyle(select);
            return (
              box.width > 0 &&
              box.height > 0 &&
              style.visibility !== "hidden" &&
              style.display !== "none"
            );
          }) as HTMLSelectElement[];
          const select = selects.find((candidate) =>
            Array.from(candidate.options).some((option) => {
              const text = normalize(option.textContent);
              return candidateLabels.some((label) => text.includes(label));
            }),
          ) ?? selects[index];

          if (!select) {
            return false;
          }

          const option = Array.from(select.options).find((candidate) => {
            const text = normalize(candidate.textContent);
            return candidateLabels.some((label) => text.includes(label));
          }) ?? select.options[0];

          if (!option) {
            return false;
          }

          select.value = option.value;
          select.dispatchEvent(new Event("input", { bubbles: true }));
          select.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        },
        { labels: normalizedLabels, fallbackSelectIndex },
      )
      .catch(() => false);

    if (selected) {
      return;
    }
  }
}

async function fillDateInputs(page: Page, inicio: string, fim: string) {
  const inicioBr = isoToBrazilian(inicio);
  const fimBr = isoToBrazilian(fim);

  for (const frame of frames(page)) {
    const filled = await frame
      .evaluate(
        ({ inicioValue, fimValue }) => {
          const inputs = Array.from(document.querySelectorAll("input")).filter((input) => {
            const element = input as HTMLInputElement;
            const box = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return (
              element.type !== "hidden" &&
              box.width > 0 &&
              box.height > 0 &&
              style.visibility !== "hidden" &&
              style.display !== "none"
            );
          }) as HTMLInputElement[];
          const dateInputs = inputs.filter(
            (input) =>
              input.type === "date" ||
              /\d{2}\/\d{2}\/\d{4}/.test(input.value) ||
              input.value === "",
          );

          if (dateInputs.length < 2) {
            return false;
          }

          dateInputs[0].value = inicioValue;
          dateInputs[1].value = fimValue;
          for (const input of dateInputs.slice(0, 2)) {
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            input.dispatchEvent(new Event("blur", { bubbles: true }));
          }

          return true;
        },
        { inicioValue: inicioBr, fimValue: fimBr },
      )
      .catch(() => false);

    if (filled) {
      return;
    }
  }
}

async function chooseRadioByLabel(page: Page, labels: string[]) {
  await clickAssociatedInput(page, labels, "radio");
}

async function checkByLabel(page: Page, labels: string[], checked: boolean) {
  await clickAssociatedInput(page, labels, "checkbox", checked);
}

async function clickAssociatedInput(
  page: Page,
  labels: string[],
  type: "radio" | "checkbox",
  checked?: boolean,
) {
  const normalizedLabels = labels.map(normalizeForMatch);

  for (const frame of frames(page)) {
    const clicked = await frame
      .evaluate(
        ({ labels: candidateLabels, targetType, expectedChecked }) => {
          const normalize = (value: string | null | undefined) =>
            (value ?? "")
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase()
              .replace(/\s+/g, " ")
              .trim();
          const labels = Array.from(document.querySelectorAll("label,span,div"));
          const label = labels.find((element) => {
            const text = normalize(element.textContent);
            const matches = candidateLabels.some(
              (candidate) => text === candidate || text.includes(candidate),
            );
            if (!matches) {
              return false;
            }

            const box = (element as HTMLElement).getBoundingClientRect();
            const style = getComputedStyle(element);
            return (
              box.width > 0 &&
              box.height > 0 &&
              style.visibility !== "hidden" &&
              style.display !== "none"
            );
          }) as HTMLElement | undefined;

          if (!label) {
            return false;
          }

          const ownInput = label.querySelector(`input[type="${targetType}"]`) as
            | HTMLInputElement
            | null;
          const input =
            ownInput ??
            (label.previousElementSibling?.querySelector?.(`input[type="${targetType}"]`) as
              | HTMLInputElement
              | null) ??
            (label.nextElementSibling?.querySelector?.(`input[type="${targetType}"]`) as
              | HTMLInputElement
              | null);

          if (input) {
            if (
              targetType === "checkbox" &&
              typeof expectedChecked === "boolean" &&
              input.checked === expectedChecked
            ) {
              return true;
            }
            input.click();
            return true;
          }

          label.click();
          return true;
        },
        {
          labels: normalizedLabels,
          targetType: type,
          expectedChecked: checked,
        },
      )
      .catch(() => false);

    if (clicked) {
      return;
    }
  }
}

async function clickFirstVisibleText(
  page: Page,
  labels: string[],
  preferredTop: number,
) {
  const normalizedLabels = labels.map(normalizeForMatch);

  for (const frame of frames(page)) {
    const point = await frame
      .evaluate(
        ({ candidateLabels, preferredTop }) => {
          const normalize = (value: string | null | undefined) =>
            (value ?? "")
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase()
              .replace(/\s+/g, " ")
              .trim();
          const elements = Array.from(
            document.querySelectorAll(
              "button,a,label,span,div,[role='button'],input[type='button'],input[type='submit']",
            ),
          );
          const visible = elements.filter((element) => {
            const text = normalize(element.textContent || (element as HTMLInputElement).value);
            const matches = candidateLabels.some(
              (label) => text === label || text.startsWith(label) || text.includes(label),
            );
            if (!matches) {
              return false;
            }
            const box = (element as HTMLElement).getBoundingClientRect();
            const style = getComputedStyle(element);
            return (
              box.width > 0 &&
              box.height > 0 &&
              style.visibility !== "hidden" &&
              style.display !== "none"
            );
          });
          const score = (element: Element) => {
            const text = normalize(
              element.textContent || (element as HTMLInputElement).value,
            );
            const box = (element as HTMLElement).getBoundingClientRect();
            const tag = element.tagName.toLowerCase();
            const exact = candidateLabels.some((label) => text === label);
            const starts = candidateLabels.some((label) => text.startsWith(label));
            let value = Math.abs(box.top - preferredTop) + text.length / 8;

            if (exact) value -= 1_000_000;
            if (starts) value -= 500_000;
            if (tag === "button") value -= 100_000;
            if (tag === "a") value -= 80_000;
            if (tag === "label") value -= 40_000;
            if (tag === "span") value -= 15_000;
            return value;
          };
          visible.sort((left, right) => score(left) - score(right));
          const element = visible[0] as HTMLElement | undefined;
          if (!element) {
            return null;
          }
          element.scrollIntoView({ block: "center" });
          const box = element.getBoundingClientRect();
          return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        },
        { candidateLabels: normalizedLabels, preferredTop },
      )
      .catch(() => null);

    if (point) {
      await page.mouse.click(point.x, point.y);
      return;
    }
  }

  throw new Error(`Nao foi possivel clicar em ${labels.join(", ")}.`);
}

async function bodyContains(page: Page, labels: string[]) {
  const normalizedLabels = labels.map(normalizeForMatch);

  return page.evaluate((candidateLabels) => {
    const normalize = (value: string | null | undefined) =>
      (value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
    const body = normalize(document.body?.innerText);
    return candidateLabels.some((label) => body.includes(label));
  }, normalizedLabels);
}

function frames(page: Page) {
  return [page.mainFrame(), ...page.frames().filter((frame) => frame !== page.mainFrame())];
}

function normalizeForMatch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isoToBrazilian(value: string) {
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
    return value;
  }

  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function tryParseJson(buffer: Buffer) {
  try {
    return JSON.parse(buffer.toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function logStep(
  status: ColetaLogEntry["status"],
  etapa: string,
  mensagem: string,
  extra: Partial<ColetaLogEntry> = {},
): ColetaLogEntry {
  return {
    timestamp: new Date().toISOString(),
    status,
    etapa,
    mensagem,
    ...extra,
  };
}

function buildPublicFilterMetadata(input: PlaywrightInput) {
  return {
    tela: "Transparencia > Compras > Analitico de Empenhos",
    ano: 2026,
    inicio: input.inicio,
    fim: input.fim,
    formato: input.formato,
    ordenacao: "Empenho",
    filtros: {
      todosEmpenhos: true,
      listarPorHistorico: true,
      ocultarAnulados: true,
      listarSubEmpenhos: true,
      listarDocumentosPagamentos: true,
      listarProcessoCompra: true,
      situacao: "Todos",
    },
  };
}
