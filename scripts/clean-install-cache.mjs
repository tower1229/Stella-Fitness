import { isAbsolute, join } from "node:path";

export function resolveCleanInstallNpmCache({ temporaryRoot, environment }) {
  const override = environment.STELLA_CLEAN_INSTALL_NPM_CACHE?.trim();
  if (override === undefined || override.length === 0) {
    return join(temporaryRoot, "npm-cache");
  }
  if (!isAbsolute(override)) {
    throw new Error("STELLA_CLEAN_INSTALL_NPM_CACHE must be an absolute path");
  }
  return override;
}
