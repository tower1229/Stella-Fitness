import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

export type Readiness =
  | "BLOCKED_CONFIGURATION"
  | "READY_FOR_SETUP"
  | "READY_WITH_LIMITED_CAPABILITIES"
  | "READY";

export type ReadinessReason = {
  code:
    | "PERSONAL_DATA_DIRECTORY_REQUIRED"
    | "PERSONAL_DATA_DIRECTORY_NOT_ABSOLUTE"
    | "PERSONAL_DATA_DIRECTORY_UNAVAILABLE"
    | "PERSONAL_DATA_DIRECTORY_NOT_A_DIRECTORY"
    | "PERSONAL_DATA_DIRECTORY_NOT_READABLE"
    | "PERSONAL_DATA_DIRECTORY_NOT_WRITABLE"
    | "PERSONAL_DATA_DIRECTORY_PROBE_CLEANUP_FAILED"
    | "DATA_DIRECTORIES_OVERLAP"
    | "RUNTIME_DIRECTORY_UNAVAILABLE"
    | "USER_TIMEZONE_REQUIRED"
    | "USER_TIMEZONE_INVALID"
    | "CONVERSATION_ACCESS_REQUIRED"
    | "STRUCTURED_MEDIA_REQUIRED"
    | "EXTRACTION_MODEL_REQUIRED"
    | "EXTRACTION_MODEL_NOT_ALLOWLISTED";
  message: string;
};

export type ConfigurationPreflightResult = {
  readiness: Readiness;
  reasons: ReadinessReason[];
  capabilities?: TechnicalReadinessCapabilities;
};

export type TechnicalReadinessCapability = {
  readonly status: "ready" | "blocked" | "limited" | "setup-required";
  readonly message: string;
};

export type TechnicalReadinessCapabilities = {
  readonly personalDataDirectory: TechnicalReadinessCapability;
  readonly conversation: TechnicalReadinessCapability;
  readonly timeZone: TechnicalReadinessCapability;
  readonly media: TechnicalReadinessCapability;
  readonly modelPermission: TechnicalReadinessCapability;
};

export type TechnicalReadiness = ConfigurationPreflightResult & {
  readonly capabilities: TechnicalReadinessCapabilities;
};

export type ExtractionPermission = "unconfigured" | "allowed" | "denied";

export function runConfigurationPreflight(options: {
  userTimezone: unknown;
  personalDataDirectory: unknown;
  runtimeDirectory: string;
  conversationAccess: boolean;
  structuredMedia: boolean;
  extraction: ExtractionPermission;
}): TechnicalReadiness {
  const reasons: ReadinessReason[] = [];
  const personalDataDirectory = validatePersonalDataDirectory(
    options.personalDataDirectory,
    reasons,
  );
  const timeZoneReason = validateUserTimezone(options.userTimezone);
  if (timeZoneReason !== undefined) reasons.push(timeZoneReason);

  if (personalDataDirectory !== undefined) {
    const canonicalPersonalDataDirectory = canonicalize(personalDataDirectory);
    const canonicalRuntimeDirectory = canonicalize(options.runtimeDirectory);
    if (pathsOverlap(canonicalPersonalDataDirectory, canonicalRuntimeDirectory)) {
      reasons.push({
        code: "DATA_DIRECTORIES_OVERLAP",
        message:
          "Personal Data Directory and Runtime Directory must not overlap",
      });
    } else {
      prepareRuntimeDirectory(options.runtimeDirectory, reasons);
      probePersonalDataDirectory(personalDataDirectory, reasons);
    }
  }

  if (!options.conversationAccess) {
    reasons.push({
      code: "CONVERSATION_ACCESS_REQUIRED",
      message: "Enable Plugin conversation hook access",
    });
  }
  if (!options.structuredMedia) {
    reasons.push({
      code: "STRUCTURED_MEDIA_REQUIRED",
      message: "Enable OpenClaw structured media extraction",
    });
  }
  if (options.extraction === "denied") {
    reasons.push({
      code: "EXTRACTION_MODEL_NOT_ALLOWLISTED",
      message: "Allowlist the configured extraction provider and model",
    });
  }

  const blockingReasons = reasons.filter(
    ({ code }) => code !== "STRUCTURED_MEDIA_REQUIRED",
  );
  const capabilities = technicalReadinessCapabilities(options, reasons);
  if (blockingReasons.length > 0) {
    return {
      readiness: "BLOCKED_CONFIGURATION",
      reasons,
      capabilities,
    };
  }

  if (options.extraction === "unconfigured") {
    return {
      readiness: "READY_FOR_SETUP",
      reasons: [
        ...reasons,
        {
          code: "EXTRACTION_MODEL_REQUIRED",
          message: "Configure an allowlisted extraction provider and model",
        },
      ],
      capabilities,
    };
  }

  if (reasons.length > 0) {
    return {
      readiness: "READY_WITH_LIMITED_CAPABILITIES",
      reasons,
      capabilities,
    };
  }

  return { readiness: "READY", reasons: [], capabilities };
}

function technicalReadinessCapabilities(
  options: {
    readonly userTimezone: unknown;
    readonly conversationAccess: boolean;
    readonly structuredMedia: boolean;
    readonly extraction: ExtractionPermission;
  },
  reasons: readonly ReadinessReason[],
): TechnicalReadinessCapabilities {
  const personalDataReason = reasons.find(({ code }) =>
    code.startsWith("PERSONAL_DATA_DIRECTORY_") ||
    code === "DATA_DIRECTORIES_OVERLAP" ||
    code === "RUNTIME_DIRECTORY_UNAVAILABLE"
  );
  return {
    personalDataDirectory: personalDataReason === undefined
      ? {
          status: "ready",
          message: "Personal Data Directory is readable and writable",
        }
      : { status: "blocked", message: personalDataReason.message },
    conversation: options.conversationAccess
      ? {
          status: "ready",
          message: "Plugin conversation hook access is enabled",
        }
      : {
          status: "blocked",
          message: "Enable Plugin conversation hook access",
        },
    timeZone: timeZoneCapability(options.userTimezone, reasons),
    media: options.structuredMedia
      ? {
          status: "ready",
          message: "OpenClaw structured media extraction is available",
        }
      : {
          status: "limited",
          message: "Enable OpenClaw structured media extraction",
        },
    modelPermission: options.extraction === "allowed"
      ? {
          status: "ready",
          message: "Extraction provider and model are allowlisted",
        }
      : options.extraction === "unconfigured"
        ? {
            status: "setup-required",
            message: "Configure an allowlisted extraction provider and model",
          }
        : {
            status: "blocked",
            message: "Allowlist the configured extraction provider and model",
          },
  };
}

function validateUserTimezone(
  value: unknown,
): ReadinessReason | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return {
      code: "USER_TIMEZONE_REQUIRED",
      message: "Configure agents.defaults.userTimezone with an IANA timezone",
    };
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return undefined;
  } catch {
    return {
      code: "USER_TIMEZONE_INVALID",
      message: "agents.defaults.userTimezone must be a valid IANA timezone",
    };
  }
}

function timeZoneCapability(
  value: unknown,
  reasons: readonly ReadinessReason[],
): TechnicalReadinessCapability {
  const reason = reasons.find(({ code }) =>
    code === "USER_TIMEZONE_REQUIRED" || code === "USER_TIMEZONE_INVALID"
  );
  return reason === undefined
    ? {
        status: "ready",
        message: `OpenClaw user timezone is ${String(value)}`,
      }
    : { status: "blocked", message: reason.message };
}

function validatePersonalDataDirectory(
  candidate: unknown,
  reasons: ReadinessReason[],
): string | undefined {
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    reasons.push({
      code: "PERSONAL_DATA_DIRECTORY_REQUIRED",
      message: "Configure an absolute Personal Data Directory",
    });
    return undefined;
  }
  if (!isAbsolute(candidate)) {
    reasons.push({
      code: "PERSONAL_DATA_DIRECTORY_NOT_ABSOLUTE",
      message: "Personal Data Directory must be an absolute path",
    });
    return undefined;
  }

  try {
    if (!statSync(candidate).isDirectory()) {
      reasons.push({
        code: "PERSONAL_DATA_DIRECTORY_NOT_A_DIRECTORY",
        message: "Personal Data Directory path must be a directory",
      });
      return undefined;
    }
  } catch {
    reasons.push({
      code: "PERSONAL_DATA_DIRECTORY_UNAVAILABLE",
      message: "Personal Data Directory must already exist",
    });
    return undefined;
  }

  return candidate;
}

function prepareRuntimeDirectory(
  runtimeDirectory: string,
  reasons: ReadinessReason[],
): void {
  try {
    mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
  } catch {
    reasons.push({
      code: "RUNTIME_DIRECTORY_UNAVAILABLE",
      message: "OpenClaw Runtime Directory is unavailable",
    });
  }
}

function probePersonalDataDirectory(
  personalDataDirectory: string,
  reasons: ReadinessReason[],
): void {
  try {
    readdirSync(personalDataDirectory);
  } catch {
    reasons.push({
      code: "PERSONAL_DATA_DIRECTORY_NOT_READABLE",
      message: "Personal Data Directory must be readable",
    });
    return;
  }

  const probePath = join(
    personalDataDirectory,
    `.stella-fitness-preflight-${process.pid}-${randomUUID()}`,
  );
  let descriptor: number | undefined;
  let cleanupFailed = false;
  try {
    descriptor = openSync(
      probePath,
      constants.O_CREAT | constants.O_EXCL | constants.O_RDWR,
      0o600,
    );
    writeFileSync(descriptor, "stella-fitness-preflight", "utf8");
    if (readFileSync(probePath, "utf8") !== "stella-fitness-preflight") {
      throw new Error("Personal Data Directory probe was not readable");
    }
  } catch {
    reasons.push({
      code: "PERSONAL_DATA_DIRECTORY_NOT_WRITABLE",
      message: "Personal Data Directory must be writable",
    });
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        cleanupFailed = true;
      }
      try {
        unlinkSync(probePath);
      } catch {
        cleanupFailed = true;
      }
    }
  }
  if (cleanupFailed) {
    reasons.push({
      code: "PERSONAL_DATA_DIRECTORY_PROBE_CLEANUP_FAILED",
      message: "Personal Data Directory probe cleanup failed",
    });
  }
}

function canonicalize(path: string): string {
  const absolutePath = resolve(path);
  const missingSegments: string[] = [];
  let existingAncestor = absolutePath;

  while (true) {
    try {
      return join(
        realpathSync.native(existingAncestor),
        ...missingSegments,
      );
    } catch {
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) {
        return absolutePath;
      }
      missingSegments.unshift(basename(existingAncestor));
      existingAncestor = parent;
    }
  }
}

function pathsOverlap(left: string, right: string): boolean {
  return isSameOrDescendant(left, right) || isSameOrDescendant(right, left);
}

function isSameOrDescendant(candidate: string, parent: string): boolean {
  const fromParent = relative(parent, candidate);
  return (
    fromParent === "" ||
    (!fromParent.startsWith("..") && !isAbsolute(fromParent))
  );
}
