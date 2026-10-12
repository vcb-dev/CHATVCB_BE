export const AGENT_TEAMS: Record<string, string> = {
  salesagent: 'sale',
  trafficagent: 'traffic',
  warehouseagent: 'kho',
};

export function normalizeAgentName(name: string) {
  return name.trim();
}

export function teamForAgent(agentName: string) {
  return AGENT_TEAMS[agentName.trim().toLowerCase()] ?? null;
}
