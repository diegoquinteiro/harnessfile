---
name: my-agent
description: ${AGENT_DESCRIPTION:-A variable-driven agent.}
runtime: claude
model: ${AGENT_MODEL:-claude-sonnet-4-6}
---
${AGENT_INSTRUCTIONS}
