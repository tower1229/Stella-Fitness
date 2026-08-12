import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const WORKBOOK_FILE_NAME = "zhuoshu-workout-log.xlsx";
const WORKBOOK_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const;
const WORKBOOK_SHA256 =
  "a113a16f9844ceb518307369bd45979af3aa703e67da8eb3bbb6b5e991aebcca";

export type PrintableLogResult = {
  readonly path: string;
  readonly fileName: typeof WORKBOOK_FILE_NAME;
  readonly mediaType: typeof WORKBOOK_MEDIA_TYPE;
  readonly sha256: typeof WORKBOOK_SHA256;
};

export async function getPrintableLogWorkbook(): Promise<PrintableLogResult> {
  const path = await resolveWorkbookPath();
  const digest = createHash("sha256").update(await readFile(path)).digest("hex");
  if (digest !== WORKBOOK_SHA256) {
    throw new Error(
      `Built-in workout-log workbook digest mismatch: expected ${WORKBOOK_SHA256}, got ${digest}`,
    );
  }
  return {
    path,
    fileName: WORKBOOK_FILE_NAME,
    mediaType: WORKBOOK_MEDIA_TYPE,
    sha256: WORKBOOK_SHA256,
  };
}

async function resolveWorkbookPath(): Promise<string> {
  const candidates = [
    new URL("../assets/zhuoshu-workout-log.xlsx", import.meta.url),
    new URL("../../sources/originals/zhuoshu-workout-log.xlsx", import.meta.url),
  ];
  for (const candidate of candidates) {
    const path = fileURLToPath(candidate);
    try {
      await access(path);
      return path;
    } catch {
      // Continue to the source-tree fallback used by tests and local development.
    }
  }
  throw new Error("Built-in workout-log workbook is missing");
}
