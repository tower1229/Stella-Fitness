export interface StellaFitnessModelConfig {
  trainingLogExtractor?: string;
  dietExtractor?: string;
  beliefExtractor?: string;
  diagnostician?: string;
  auditor?: string;
  reporter?: string;
}

export interface StellaFitnessConfig {
  agentIds?: string[];
  dataDir?: string;
  models?: StellaFitnessModelConfig;
}

export function isAgentInScope(
  config: StellaFitnessConfig,
  agentId: string | undefined,
): boolean {
  if (!config.agentIds || config.agentIds.length === 0) {
    return true;
  }

  return agentId !== undefined && config.agentIds.includes(agentId);
}
