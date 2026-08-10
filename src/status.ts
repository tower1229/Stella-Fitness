export const STATUS_TEXT =
  "Stella Fitness: ready\ncontract: openclaw@2026.7.1-2\nscope: recording-only";

export function createStatusResponse(): { text: string } {
  return { text: STATUS_TEXT };
}
