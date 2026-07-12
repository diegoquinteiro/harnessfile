import type { Next, Problem, SquadMember } from '../types'
import type { ParsedProject } from './parse'

function nextTargets(next: Next | undefined): string[] {
  if (!next) return []
  return Array.isArray(next) ? next : [next]
}

/**
 * Client-side checks mirroring spec v0.2 (spec/v0.2-draft.md, D39–D49):
 * version, reference resolution, graph edge integrity, squad membership.
 */
export function validate(project: ParsedProject): Problem[] {
  const problems: Problem[] = []
  const { harness, parseError, agents, squads, skills } = project

  if (parseError) {
    problems.push({ severity: 'error', message: parseError })
  }
  if (!harness) return problems

  if (harness.harnessfile !== '0.2') {
    problems.push({
      severity: 'error',
      where: 'harness.yaml',
      message: `harnessfile version must be "0.2" (found ${JSON.stringify(harness.harnessfile ?? null)})`,
    })
  }
  if (!harness.name || typeof harness.name !== 'string') {
    problems.push({ severity: 'error', where: 'harness.yaml', message: 'name is required' })
  }

  const agentSlugs = new Set(agents.map((a) => a.slug))
  const squadSlugs = new Set(squads.map((s) => s.slug))
  const skillNames = new Set(skills.map((s) => s.name))
  const runtimeNames = new Set(Object.keys(harness.runtimes ?? {}))

  for (const [name, runtime] of Object.entries(harness.runtimes ?? {})) {
    if (!runtime.protocol) {
      problems.push({
        severity: 'error',
        where: `runtimes.${name}`,
        message: 'runtime profile needs a protocol family',
      })
    } else if (!/^[a-z0-9-]+\/v[0-9]+$/.test(runtime.protocol)) {
      problems.push({
        severity: 'error',
        where: `runtimes.${name}.protocol`,
        message: 'runtime protocol must match <family>/v<version>',
      })
    }
    if (runtime.command && (runtime.command.includes('/') || runtime.command.includes('\\'))) {
      problems.push({
        severity: 'error',
        where: `runtimes.${name}.command`,
        message: 'runtime command must be a portable executable name, not a path',
      })
    }
  }

  for (const agent of agents) {
    const runtime = typeof agent.fm.runtime === 'string' ? agent.fm.runtime : undefined
    if (runtime && !runtimeNames.has(runtime)) {
      problems.push({
        severity: 'error',
        where: agent.path,
        message: `runtime "${runtime}" not found in harness.yaml runtimes`,
      })
    }
  }

  const triggers = harness.triggers ?? {}
  const steps = harness.steps ?? {}

  // Triggers are sugar for steps — they share one node namespace.
  const nodeNames = new Set([...Object.keys(steps), ...Object.keys(triggers)])
  for (const name of Object.keys(triggers)) {
    if (name in steps) {
      problems.push({
        severity: 'error',
        where: `triggers.${name}`,
        message: `"${name}" is declared both as a trigger and a step (one namespace)`,
      })
    }
  }

  // Trigger checks
  for (const [name, trig] of Object.entries(triggers)) {
    if (!trig.provider && !trig.schedule) {
      problems.push({
        severity: 'error',
        where: `triggers.${name}`,
        message: 'a trigger needs a provider or a schedule',
      })
    }
    for (const target of nextTargets(trig.next)) {
      if (!(target in steps)) {
        problems.push({
          severity: 'error',
          where: `triggers.${name}`,
          message: `next → "${target}" does not exist in steps`,
        })
      }
    }
  }

  // Step checks
  for (const [name, step] of Object.entries(steps)) {
    if (step.agent && step.squad) {
      problems.push({
        severity: 'error',
        where: `steps.${name}`,
        message: 'a step cannot set both agent: and squad:',
      })
    }
    if (step.agent && !agentSlugs.has(step.agent)) {
      problems.push({
        severity: 'error',
        where: `steps.${name}`,
        message: `agent "${step.agent}" not found in agents/`,
      })
    }
    if (step.squad && !squadSlugs.has(step.squad)) {
      problems.push({
        severity: 'error',
        where: `steps.${name}`,
        message: `squad "${step.squad}" not found in squads/`,
      })
    }
    if (step.type === 'router') {
      if (!step.agent) {
        problems.push({
          severity: 'error',
          where: `steps.${name}`,
          message: 'a router needs an agent to classify',
        })
      }
      for (const [route, target] of Object.entries(step.routes ?? {})) {
        if (!nodeNames.has(target)) {
          problems.push({
            severity: 'error',
            where: `steps.${name}`,
            message: `route "${route}" → "${target}" does not exist`,
          })
        }
      }
    }
    for (const target of nextTargets(step.next)) {
      if (!nodeNames.has(target)) {
        problems.push({
          severity: 'error',
          where: `steps.${name}`,
          message: `next → "${target}" does not exist`,
        })
      }
    }
    if (
      !step.agent &&
      !step.squad &&
      (step.type === undefined || step.type === 'agent' || step.type === 'squad')
    ) {
      problems.push({
        severity: 'error',
        where: `steps.${name}`,
        message: 'an agent step needs agent: or squad:',
      })
    }
  }

  // Squad checks: leader/members resolve, leader ∈ members
  for (const squad of squads) {
    const leader = typeof squad.fm.leader === 'string' ? squad.fm.leader : undefined
    const members = Array.isArray(squad.fm.members) ? (squad.fm.members as SquadMember[]) : []
    if (!leader) {
      problems.push({
        severity: 'error',
        where: squad.path,
        message: 'squad has no leader',
      })
    } else if (!agentSlugs.has(leader)) {
      problems.push({
        severity: 'error',
        where: squad.path,
        message: `leader "${leader}" not found in agents/`,
      })
    }
    if (members.length === 0) {
      problems.push({ severity: 'error', where: squad.path, message: 'squad has no members' })
    }
    for (const member of members) {
      if (!member || typeof member.agent !== 'string') {
        problems.push({
          severity: 'error',
          where: squad.path,
          message: 'each member needs an agent slug',
        })
      } else if (!agentSlugs.has(member.agent)) {
        problems.push({
          severity: 'error',
          where: squad.path,
          message: `member "${member.agent}" not found in agents/`,
        })
      }
    }
    if (leader && members.length > 0 && !members.some((m) => m && m.agent === leader)) {
      problems.push({
        severity: 'error',
        where: squad.path,
        message: `leader "${leader}" must also appear in members`,
      })
    }
  }

  // Entity frontmatter basics + skill references (warning-level)
  for (const agent of agents) {
    if (typeof agent.fm.name !== 'string' || typeof agent.fm.description !== 'string') {
      problems.push({
        severity: 'error',
        where: agent.path,
        message: 'agent frontmatter needs name and description',
      })
    }
    if (typeof agent.fm.name === 'string' && agent.fm.name !== agent.slug) {
      problems.push({
        severity: 'warning',
        where: agent.path,
        message: `frontmatter name "${agent.fm.name}" differs from file slug "${agent.slug}"`,
      })
    }
    const agentSkills = Array.isArray(agent.fm.skills) ? agent.fm.skills : []
    for (const s of agentSkills) {
      if (typeof s === 'string' && !skillNames.has(s)) {
        problems.push({
          severity: 'warning',
          where: agent.path,
          message: `skill "${s}" not found in skills/`,
        })
      }
    }
  }

  return problems
}
