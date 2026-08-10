declare const sanitizedMediaCopyBrand: unique symbol;

export type SanitizedMediaCopy = {
  readonly bytes: Buffer;
  readonly fileName: string;
  readonly mime: string;
  readonly [sanitizedMediaCopyBrand]: true;
};

export function createSanitizedMediaCopy(input: {
  bytes: Buffer;
  fileName: string;
  mime: string;
}): SanitizedMediaCopy {
  return {
    bytes: Buffer.from(input.bytes),
    fileName: input.fileName,
    mime: input.mime,
  } as SanitizedMediaCopy;
}
