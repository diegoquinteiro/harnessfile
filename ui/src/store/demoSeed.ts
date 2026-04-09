import type { Agent } from '../types/harnessfile';
import type { StepNodeData } from './useHarnessStore';

interface SeedNode {
  position: { x: number; y: number };
  data: StepNodeData;
}

export const demoAgents: Record<string, Agent> = {
  classifier: {
    model: 'anthropic/claude-haiku-4-5',
    instructions: 'Classify the Jira ticket as feature, bug, or refactor.',
  },
  researcher: {
    model: 'anthropic/claude-sonnet-4-6',
    instructions: 'Research the problem space thoroughly.',
    tools: [{ mcp: './tools/web-search.json' }],
  },
  'spec-writer': {
    model: 'anthropic/claude-sonnet-4-6',
    instructions: 'Write a detailed technical spec from research findings.',
  },
  'frontend-dev': {
    model: 'anthropic/claude-sonnet-4-6',
    instructions: 'Implement frontend changes following React patterns.',
    skills: ['./skills/coding.md', './skills/code-review.md'],
  },
  'backend-dev': {
    model: 'anthropic/claude-sonnet-4-6',
    instructions: 'Implement backend changes following our API patterns.',
    skills: ['./skills/coding.md', './skills/code-review.md'],
  },
};

export const demoNodes: SeedNode[] = [
  {
    position: { x: 0, y: 200 },
    data: { label: 'Jira Trigger', stepType: 'trigger', event: 'ticket-created', provider: 'jira/v1', filter: 'project = ENG AND type = Story' },
  },
  {
    position: { x: 280, y: 200 },
    data: { label: 'Classify', stepType: 'router', agent: 'classifier' },
  },
  {
    position: { x: 560, y: 80 },
    data: { label: 'Research', stepType: 'agent', agent: 'researcher', eval: [{ metric: 'llm-judge', type: 'llm', prompt: 'Is this research thorough and actionable?', pass: 0.8 }], maxIterations: 3 },
  },
  {
    position: { x: 560, y: 320 },
    data: { label: 'Write Spec', stepType: 'agent', agent: 'spec-writer' },
  },
  {
    position: { x: 840, y: 200 },
    data: { label: 'Plan Review', stepType: 'gate', approve: 'human', channel: '#approvals', provider: 'slack/v1', timeout: '1h', fallback: 'reject' },
  },
  {
    position: { x: 1120, y: 100 },
    data: { label: 'Frontend', stepType: 'agent', agent: 'frontend-dev', eval: [{ metric: 'tests-pass', type: 'code', pass: true }, { metric: 'lint-pass', type: 'code', pass: true }], maxIterations: 3 },
  },
  {
    position: { x: 1120, y: 300 },
    data: { label: 'Backend', stepType: 'agent', agent: 'backend-dev', eval: [{ metric: 'tests-pass', type: 'code', pass: true }, { metric: 'coverage', type: 'code', pass: '80%' }], maxIterations: 3 },
  },
  {
    position: { x: 1400, y: 200 },
    data: { label: 'Done', stepType: 'output' },
  },
];

// Edges as [sourceIndex, targetIndex, routeLabel?]
export const demoEdges: [number, number, string?][] = [
  [0, 1],                // trigger -> classify
  [1, 2, 'feature'],     // classify -feature-> research
  [1, 3, 'bug'],         // classify -bug-> write spec
  [2, 4],                // research -> plan review
  [3, 4],                // write spec -> plan review
  [4, 5],                // plan review -> frontend
  [4, 6],                // plan review -> backend
  [5, 7],                // frontend -> done
  [6, 7],                // backend -> done
];
