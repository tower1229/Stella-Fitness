// These handlers intentionally do nothing in Phase 0.
//
// The implementation must claim a turn only after the ingress router can
// deterministically identify Stella Fitness domain input. Until then, falling
// through to the normal OpenClaw Agent is safer than partially implementing
// the supervision pipeline.

export async function beforeAgentReply(
  _event: unknown,
  _context: unknown,
): Promise<undefined> {
  return undefined;
}

export async function beforeAgentRun(
  _event: unknown,
  _context: unknown,
): Promise<undefined> {
  return undefined;
}
