export type ProgramSessionStatus = "resolved" | "unresolved";

export type ProgramSessionKind =
  | "full-body"
  | "torso"
  | "limbs"
  | "torso-recovery"
  | "limbs-recovery";

export interface ProgramSessionKey {
  programId: string;
  programVersion: string;
  week: number;
  day: string;
}

export interface ResolvedProgramSession extends ProgramSessionKey {
  status: "resolved";
  kind: ProgramSessionKind;
  sourceRef?: string;
}

export interface UnresolvedProgramSession extends ProgramSessionKey {
  status: "unresolved";
  kind: ProgramSessionKind;
  reason: string;
  sourceRef?: string;
}

export type ProgramSession =
  | ResolvedProgramSession
  | UnresolvedProgramSession;

export interface ProgramRepository {
  getSession(key: ProgramSessionKey): ProgramSession | undefined;
}

export class UnresolvedProgramSessionError extends Error {
  constructor(public readonly session: UnresolvedProgramSession) {
    super(
      `Program session is unresolved: ${session.programId}@${session.programVersion} week ${session.week} ${session.day}`,
    );
    this.name = "UnresolvedProgramSessionError";
  }
}
