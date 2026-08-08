import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import {
  beforeAgentReply,
  beforeAgentRun,
} from "./plugin/hooks.js";

export default definePluginEntry({
  id: "stella-fitness",
  name: "Stella Fitness",
  description:
    "Evidence-first hypertrophy supervision with isolated diagnosis and deterministic policy gating.",
  register(api) {
    // Phase 0 skeleton: hooks are intentionally pass-through until the ingress
    // router and supervision pipeline are implemented and covered by tests.
    api.on("before_agent_reply", beforeAgentReply, { priority: 100 });
    api.on("before_agent_run", beforeAgentRun, { priority: 100 });
  },
});
