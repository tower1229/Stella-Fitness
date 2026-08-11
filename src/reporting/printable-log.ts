import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import sharp from "sharp";

import type { PlannedExercise, PlannedSession } from "../domain/program.js";
import { resolvePlannedSession } from "../program/engine.js";
import { readActiveProgram } from "../program/state.js";

export type PrintableLogRange = "today" | "week" | "phase";

export type PrintableLogResult = {
  readonly range: PrintableLogRange;
  readonly path: string;
  readonly mediaType: "application/pdf";
  readonly layout: "ordinary-training" | "strength-test" | "mixed";
  readonly pages: number;
};

export async function generatePrintableLog(options: {
  readonly personalDataDirectory: string;
  readonly range: PrintableLogRange;
  readonly date: string;
}): Promise<PrintableLogResult> {
  const { program, state } = await readActiveProgram({
    personalDataDirectory: options.personalDataDirectory,
  });
  const dates = datesForRange(state.cycle.startDate, options.date, options.range);
  const sessions = dates.flatMap((date) => {
    const session = resolvePlannedSession({
      program,
      programVersion: state.program.version,
      cycleStart: state.cycle.startDate,
      date,
    });
    return session === null ? [] : [session];
  });
  if (sessions.length === 0) {
    throw new Error(`Printable Log has no planned sessions for ${options.range}`);
  }
  const directory = join(options.personalDataDirectory, "derived", "printable-logs");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `${options.range}-${options.date}.pdf`);
  const pdf = await createPdf(sessions);
  await writeFile(path, pdf, { mode: 0o600 });
  const layouts = new Set(sessions.map((session) =>
    session.type === "strength-test" ? "strength-test" : "ordinary-training",
  ));
  return {
    range: options.range,
    path,
    mediaType: "application/pdf",
    layout: layouts.size > 1
      ? "mixed"
      : layouts.has("strength-test")
        ? "strength-test"
        : "ordinary-training",
    pages: sessions.length,
  };
}

function datesForRange(
  cycleStart: string,
  date: string,
  range: PrintableLogRange,
): readonly string[] {
  const start = parseDate(cycleStart);
  const target = parseDate(date);
  const dayOffset = Math.floor((target.getTime() - start.getTime()) / 86_400_000);
  if (dayOffset < 0 || dayOffset >= 84) return [];
  if (range === "today") return [date];
  const weekIndex = Math.floor(dayOffset / 7);
  const firstWeek = range === "week" ? weekIndex : Math.floor(weekIndex / 4) * 4;
  const days = range === "week" ? 7 : 28;
  return Array.from({ length: days }, (_, index) =>
    new Date(start.getTime() + (firstWeek * 7 + index) * 86_400_000)
      .toISOString()
      .slice(0, 10),
  );
}

async function createPdf(sessions: readonly PlannedSession[]): Promise<Buffer> {
  const images = await Promise.all(sessions.map(renderPageImage));
  const objects: Buffer[] = [];
  const pageObjectIds = sessions.map((_, index) => 3 + index * 3);
  objects.push(ascii("<< /Type /Catalog /Pages 2 0 R >>"));
  objects.push(ascii(
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${sessions.length} >>`,
  ));
  images.forEach((image, index) => {
    const pageId = pageObjectIds[index]!;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const content = `q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ`;
    objects.push(ascii(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R /ActualFieldsBlank true >>`,
    ));
    objects.push(streamObject(ascii(content), ""));
    objects.push(streamObject(
      image,
      "/Type /XObject /Subtype /Image /Width 1240 /Height 1754 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ",
    ));
  });
  return serializePdf(objects);
}

async function renderPageImage(session: PlannedSession): Promise<Buffer> {
  const strengthTest = session.type === "strength-test";
  const headers = strengthTest
    ? ["动作", "测试", "结果 (空白)"]
    : ["动作", "计划处方", "Actual (空白)", "动作质量", "问题备注"];
  const widths = strengthTest
    ? [500, 360, 220]
    : [250, 260, 190, 180, 200];
  const rows = strengthTest
    ? session.tests.map((test) => [test.exerciseId, test.test, ""])
    : session.exercises.map((exercise) => [
        exercise.displayName ?? exercise.exerciseId,
        formatPrescription(exercise),
        "",
        "",
        "",
      ]);
  const tableX = 80;
  const tableY = 330;
  const headerHeight = 72;
  const rowHeight = 116;
  const tableWidth = widths.reduce((sum, width) => sum + width, 0);
  const verticals = widths.reduce<number[]>((positions, width) => {
    positions.push(positions.at(-1)! + width);
    return positions;
  }, [tableX]);
  const rowLines = Array.from({ length: rows.length + 2 }, (_, index) =>
    tableY + (index === 0 ? 0 : headerHeight + (index - 1) * rowHeight),
  );
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1240" height="1754" viewBox="0 0 1240 1754">
      <rect width="1240" height="1754" fill="white"/>
      <style>
        text { font-family: "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", Arial, sans-serif; fill: #111; }
        .title { font-size: 42px; font-weight: 700; }
        .meta { font-size: 24px; }
        .header { font-size: 22px; font-weight: 700; }
        .cell { font-size: 20px; }
        .footer { font-size: 18px; fill: #444; }
      </style>
      <text x="80" y="100" class="title">Stella Fitness 可打印训练日志</text>
      <text x="80" y="160" class="meta">${escapeXml(session.date)} · 第 ${session.cycle.week} 周 · ${escapeXml(session.cycle.phase)}</text>
      <text x="80" y="205" class="meta">训练日: ${escapeXml(session.day)} · 类型: ${escapeXml(session.type)}</text>
      <text x="80" y="260" class="meta">${strengthTest ? "力量测试专用布局" : "计划处方已预填，Actual、动作质量和问题备注保持空白"}</text>
      <rect x="${tableX}" y="${tableY}" width="${tableWidth}" height="${headerHeight + rows.length * rowHeight}" fill="none" stroke="#111" stroke-width="3"/>
      ${verticals.slice(1, -1).map((x) => `<line x1="${x}" y1="${tableY}" x2="${x}" y2="${tableY + headerHeight + rows.length * rowHeight}" stroke="#111" stroke-width="2"/>`).join("")}
      ${rowLines.slice(1, -1).map((y) => `<line x1="${tableX}" y1="${y}" x2="${tableX + tableWidth}" y2="${y}" stroke="#111" stroke-width="2"/>`).join("")}
      ${headers.map((header, index) => `<text x="${verticals[index]! + 14}" y="${tableY + 46}" class="header">${escapeXml(header)}</text>`).join("")}
      ${rows.flatMap((row, rowIndex) => row.map((cell, columnIndex) => `<text x="${verticals[columnIndex]! + 14}" y="${tableY + headerHeight + rowIndex * rowHeight + 42}" class="cell">${escapeXml(cell)}</text>`)).join("")}
      <text x="80" y="1660" class="footer">Program: ${escapeXml(session.program.id)}@${escapeXml(session.program.version)} · Cycle: ${escapeXml(session.cycle.startDate)}</text>
      <text x="80" y="1700" class="footer">仅记录计划与事实，不评价表现，不提供训练、营养或健康建议。</text>
    </svg>`;
  return await sharp(Buffer.from(svg))
    .flatten({ background: "white" })
    .grayscale()
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

function formatPrescription(exercise: PlannedExercise): string {
  const prescription = exercise.prescription;
  if (prescription.type === "sets_reps") return `${prescription.sets} x ${prescription.reps}`;
  if (prescription.type === "rep_range") {
    return `${prescription.sets} x ${prescription.minReps}-${prescription.maxReps}`;
  }
  if (prescription.type === "total_reps") return `总次数 ${prescription.reps}`;
  if (prescription.type === "duration") return `${prescription.sets} x ${prescription.seconds}s`;
  return `${prescription.sets} 组至力竭`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function streamObject(bytes: Buffer, dictionary: string): Buffer {
  return Buffer.concat([
    ascii(`<< ${dictionary}/Length ${bytes.length} >>\nstream\n`),
    bytes,
    ascii("\nendstream"),
  ]);
}

function serializePdf(objects: readonly Buffer[]): Buffer {
  const chunks: Buffer[] = [ascii("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")];
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(chunks.reduce((total, chunk) => total + chunk.length, 0));
    chunks.push(ascii(`${index + 1} 0 obj\n`), object, ascii("\nendobj\n"));
  });
  const xrefOffset = chunks.reduce((total, chunk) => total + chunk.length, 0);
  chunks.push(ascii(
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ));
  return Buffer.concat(chunks);
}

function ascii(value: string): Buffer {
  return Buffer.from(value, "latin1");
}

function parseDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("Printable Log date must use a valid YYYY-MM-DD date");
  }
  return parsed;
}
