export function resolveCleanInstallNpmCache(options: {
  readonly temporaryRoot: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
}): string;
