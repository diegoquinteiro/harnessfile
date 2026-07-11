---
name: research
description: >
  Deep parallel codebase research before planning or implementation. Spawns 4 specialized agents
  that explore behavior, architecture, coding standards, and test coverage simultaneously, then
  synthesizes findings into a structured RESEARCH.md document. Use this skill when the user says
  "research", "investigate", "explore the codebase", "understand the code", "deep dive", or
  wants thorough analysis of an area before making changes. Also use it as the first step of any
  complex feature — research first, then plan, then implement.
---

# Research

Perform deep, parallel codebase research on a topic or feature area, producing a structured
research document that serves as the foundation for planning and implementation.

## Arguments

The user provides a description of what they want to research — a feature to build, a bug to
investigate, an area to understand, or a change they're considering. This description guides
all four research agents.

Example: `/research add real-time notifications for analysis completion`

## Step 1: Identify the search scope

Before spawning agents, read the project's AGENTS.md to understand the repo structure. Then
determine which areas of the codebase are most relevant to the user's topic. Identify:

- Key search terms and related concepts
- Which parts of the stack are involved (server, web, or both)
- Relevant model names, schema files, job files, and component paths

Briefly tell the user what you're about to research and which areas you'll focus on.

## Step 2: Spawn 4 research agents in parallel

Launch all four agents in a single message so they run concurrently. Each agent uses
`subagent_type="Explore"` and should be instructed to be "very thorough" in its exploration.

Pass each agent the user's topic description plus the search scope you identified in Step 1,
so they know where to focus.

### Agent 1 — Behavior

Prompt this agent to understand what the relevant code **currently does**:

- Trace user-facing flows end-to-end (frontend action → GraphQL mutation/query → backend resolver → job/service → database)
- Identify business logic, validation rules, and side effects
- Map data flow: what gets created, read, updated, deleted, and in what order
- List the GraphQL queries and mutations involved (both schema definitions in server/ and usage in web/models/)
- Note any async jobs that get triggered and what they do
- Document external service calls (APIs, AI models, storage)

### Agent 2 — Architecture

Prompt this agent to map the structural landscape:

- File organization: which directories and files contain the relevant code
- Module boundaries: how the relevant code is split across modules
- Dependency graph: what imports what, which components depend on which hooks/utilities
- Database models involved: fields, relationships, indexes
- Django patterns: serializers, resolvers, middleware, signals
- Next.js patterns: App Router structure, server vs client components, data fetching strategy
- Shared infrastructure: job framework, caching, error handling utilities

### Agent 3 — Coding Standards

Prompt this agent to identify conventions used in the relevant area:

- Naming patterns: how files, functions, classes, variables, and GraphQL types are named
- Error handling style: how errors are raised, caught, and returned to the frontend
- Logging practices: what gets logged and at what level
- Import conventions: ordering, absolute vs relative paths
- TypeScript patterns: type definitions, generics, null handling, component props
- Python patterns: type hints, dataclasses vs dicts, string formatting
- Code organization within files: ordering of methods, class structure
- Any patterns that are specific to this area and differ from the rest of the codebase

### Agent 4 — Test Coverage

Prompt this agent to analyze the testing landscape for this area:

- Find existing tests related to the topic (search test directories for relevant model/function names)
- Identify which test tier they use: mocked (default), VCR cassettes, or integration
- Document fixture patterns: how test data is set up (factories, fixtures, inline creation)
- Note the assertion style and what aspects are tested vs not tested
- Identify coverage gaps: code paths that lack tests
- Check for test utilities or helpers specific to this area
- Look at conftest.py files for relevant fixtures

## Step 3: Synthesize the research document

After all four agents complete, synthesize their findings into a single coherent document.
Don't just concatenate — cross-reference findings across dimensions and highlight insights
that emerge from combining perspectives.

Write the document to `RESEARCH.md` in the project root.

### Document structure

```markdown
# Research: [Topic]

> [One-paragraph executive summary: what this area does, how it's structured, and the key
> things anyone modifying it needs to know]

## Current Behavior

[Synthesized findings from the Behavior agent. Focus on end-to-end flows, data lifecycle,
and side effects. Use bullet points and short code path references like
`server/path/file.py:ClassName.method`]

## Architecture

[Synthesized findings from the Architecture agent. Include a text-based diagram if the
relationships are complex enough to warrant it. List key files and their roles.]

### Key Files
| File | Role |
|------|------|
| `server/...` | ... |
| `web/...` | ... |

## Coding Standards

[Synthesized findings from the Standards agent. Only include patterns that would actually
guide implementation — skip obvious things like "uses Python 3".]

## Test Coverage

[Synthesized findings from the Test Coverage agent. Include what's tested, what's not,
and what patterns to follow when adding new tests.]

### Existing Tests
| Test File | What it covers | Tier |
|-----------|----------------|------|
| `server/tests/...` | ... | mocked/VCR/integration |

## Synthesis

[This is the most valuable section. Cross-reference the four dimensions and surface:
- Risks: areas with complex behavior but low test coverage
- Patterns to follow: how similar features were built before
- Constraints: architectural decisions that limit how changes can be made
- Opportunities: existing infrastructure that can be reused
- Open questions: things the research couldn't fully resolve]
```

## Step 4: Present results

After saving RESEARCH.md, tell the user:

1. Where the research document was saved
2. A brief (3-5 bullet) summary of the most important findings
3. Suggest they review RESEARCH.md and then use plan mode or `/plan` to create an
   implementation plan informed by the research

## Squad context

When you run this as the **Researcher** agent on a Multica issue (not standalone), write the
synthesized findings into the **issue** and hand off to the **Planner** — set the issue to
`todo` and assign the Planner — instead of suggesting `/plan`. `RESEARCH.md` is for standalone
Claude Code use.
