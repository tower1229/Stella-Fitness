export type FitnessQueryIntent =
  | { readonly kind: "current-state" }
  | { readonly kind: "recent-training" }
  | { readonly kind: "today" }
  | { readonly kind: "week" };

export type FitnessQueryClassification =
  | { readonly status: "classified"; readonly intent: FitnessQueryIntent }
  | {
      readonly status:
        | "low-confidence"
        | "timeout"
        | "provider-error"
        | "invalid-output"
        | "missing-agent-id";
    };

export type FitnessQueryClassifier = {
  classify(input: {
    readonly text: string;
  }): Promise<FitnessQueryClassification>;
};

export function parseDeterministicFitnessQuery(
  text: string,
): FitnessQueryIntent | undefined {
  const normalized = text.trim();
  if (
    /^(?:目前|当前|现在)(?:的)?(?:训练)?(?:进度|状态|练到哪(?:儿)?了?)(?:是|怎么样|如何)?[。.!！?？]*$/u.test(
      normalized,
    )
  ) {
    return { kind: "current-state" };
  }
  if (
    /^(?:我)?(?:最近|上次)(?:训练)?(?:练|做到|进行)到哪(?:儿)?了?[。.!！?？]*$/u.test(
      normalized,
    )
  ) {
    return { kind: "recent-training" };
  }
  if (/^(?:今天|今日)(?:的)?(?:训练|进度|记录|安排)(?:呢|怎么样|是什么|有哪些)?[。.!！?？]*$/u.test(normalized)) {
    return { kind: "today" };
  }
  if (/^(?:本周|这周)(?:的)?(?:训练|进度|记录|安排)(?:呢|怎么样|是什么|有哪些)?[。.!！?？]*$/u.test(normalized)) {
    return { kind: "week" };
  }
  return undefined;
}

export function looksLikeExactFitnessQuery(text: string): boolean {
  const normalized = text.trim();
  const fitnessScope = /(?:训练|练到|进度|第几周|阶段|周期|记录|session|workout|progress)/iu;
  const requestShape = /(?:[?？]|哪(?:儿)?|第几|多少|目前|当前|现在|最近.*练|状态|情况|进度|安排|计划|到哪一步|how|what|which|where|so far)/iu;
  return fitnessScope.test(normalized) && requestShape.test(normalized);
}
