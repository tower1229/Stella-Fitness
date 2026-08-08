import {
  UnresolvedProgramSessionError,
  type ProgramRepository,
  type ProgramSessionKey,
  type ResolvedProgramSession,
} from "../domain/program.js";

/**
 * Deterministically resolves what the canonical program says should happen.
 * This layer does not decide whether the user should follow or modify it.
 */
export function resolvePlannedSession(
  repository: ProgramRepository,
  key: ProgramSessionKey,
): ResolvedProgramSession {
  const session = repository.getSession(key);

  if (!session) {
    throw new Error(
      `Program session not found: ${key.programId}@${key.programVersion} week ${key.week} ${key.day}`,
    );
  }

  if (session.status === "unresolved") {
    throw new UnresolvedProgramSessionError(session);
  }

  return session;
}
