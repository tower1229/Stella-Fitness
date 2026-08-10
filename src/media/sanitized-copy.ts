declare const sanitizedMediaCopyBrand: unique symbol;

export type SanitizedMediaCopy = {
  readonly bytes: Buffer;
  readonly fileName: string;
  readonly mime: string;
  readonly [sanitizedMediaCopyBrand]: true;
};
