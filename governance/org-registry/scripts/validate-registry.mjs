#!/usr/bin/env node

import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, resolve} from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultFixture = resolve(scriptDirectory, "../fixtures/valid-registry.json");

const isRecord = value =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function addUniqueErrors(items, field, label, errors) {
  const seen = new Set();
  for (const item of items) {
    const value = item?.[field];
    if (typeof value !== "string" || value.length === 0) {
      errors.push(label + ": missing " + field);
    } else if (seen.has(value)) {
      errors.push(label + ": duplicate " + field + ' "' + value + '"');
    } else {
      seen.add(value);
    }
  }
  return seen;
}

function validateRegistry(registry) {
  const errors = [];
  if (!isRecord(registry)) {
    return {valid: false, errors: ["registry must be a JSON object"]};
  }

  const arrayFields = [
    "units",
    "agents",
    "connections",
    "assignments",
    "policies",
    "forbiddenActions",
    "sensitiveActions",
  ];
  for (const field of arrayFields) {
    if (!Array.isArray(registry[field])) {
      errors.push("registry." + field + " must be an array");
    }
  }
  if (errors.length > 0) return {valid: false, errors};
  if (registry.schemaVersion !== 1) {
    errors.push("registry.schemaVersion must equal 1");
  }

  const unitIds = addUniqueErrors(registry.units, "id", "units", errors);
  const agentIds = addUniqueErrors(registry.agents, "id", "agents", errors);
  const unitById = new Map(
    registry.units.filter(unit => typeof unit?.id === "string").map(unit => [unit.id, unit]),
  );
  const agentById = new Map(
    registry.agents.filter(agent => typeof agent?.id === "string").map(agent => [agent.id, agent]),
  );

  // The unit tree and actor reporting chain are separate structures.
  const roots = registry.units.filter(
    unit => unit?.level === 0 && unit?.kind === "root" && unit?.parentId === null,
  );
  if (roots.length !== 1) {
    errors.push("units: expected exactly one root unit; found " + roots.length);
  }

  for (const unit of registry.units) {
    if (!isRecord(unit) || !unitIds.has(unit.id)) continue;
    if (!Number.isInteger(unit.level) || unit.level < 0 || unit.level > 2) {
      errors.push('unit "' + unit.id + '": level must be an integer from 0 to 2');
    }
    if (unit.level === 0) {
      if (unit.parentId !== null || unit.kind !== "root") {
        errors.push('unit "' + unit.id + '": root must have kind "root" and no parent');
      }
    } else {
      const parent = unitById.get(unit.parentId);
      if (!parent) {
        errors.push('unit "' + unit.id + '": parent "' + unit.parentId + '" does not exist');
      } else if (!Number.isInteger(parent.level) || parent.level > unit.level) {
        errors.push('unit "' + unit.id + '": parent level cannot exceed child level');
      }
    }
    if (unit.level === 2 && unit.kind !== "domain") {
      errors.push('unit "' + unit.id + '": level-2 units must be domain units');
    }
  }

  for (const unit of registry.units) {
    if (!isRecord(unit) || !unitIds.has(unit.id)) continue;
    const visited = new Set();
    let cursor = unit;
    while (cursor && cursor.parentId !== null) {
      if (visited.has(cursor.id)) {
        errors.push('unit "' + unit.id + '": parent cycle detected');
        cursor = null;
        break;
      }
      visited.add(cursor.id);
      cursor = unitById.get(cursor.parentId);
    }
    if (cursor && cursor.level !== 0) {
      errors.push('unit "' + unit.id + '": parent chain does not terminate at a root');
    }
  }

  // Validate actor levels, role kinds, and unit references.
  for (const agent of registry.agents) {
    if (!isRecord(agent) || !agentIds.has(agent.id)) continue;
    const unit = unitById.get(agent.unitId);
    if (!unit) {
      errors.push('agent "' + agent.id + '": unit "' + agent.unitId + '" does not exist');
    }
    if (!Number.isInteger(agent.level) || agent.level < 0 || agent.level > 3) {
      errors.push('agent "' + agent.id + '": level must be an integer from 0 to 3');
      continue;
    }
    const expectedKinds = {
      0: ["human_owner"],
      1: ["l1_manager"],
      2: ["l2_manager"],
      3: ["l3_specialist", "l3_manager"],
    }[agent.level];
    if (!expectedKinds.includes(agent.positionKind)) {
      errors.push('agent "' + agent.id + '": positionKind does not match level ' + agent.level);
    }
    if (!["active", "defined", "planned", "suspended", "retired"].includes(agent.status)) {
      errors.push('agent "' + agent.id + '": invalid status "' + agent.status + '"');
    }
    if (!Array.isArray(agent.managerOf)) {
      errors.push('agent "' + agent.id + '": managerOf must be an array');
    }
  }

  const owners = registry.agents.filter(
    agent => agent?.level === 0 && agent?.positionKind === "human_owner",
  );
  const levelOnes = registry.agents.filter(
    agent => agent?.level === 1 && agent?.positionKind === "l1_manager",
  );
  if (owners.length !== 1) {
    errors.push("agents: expected exactly one level-0 owner; found " + owners.length);
  }
  if (levelOnes.length !== 1) {
    errors.push("agents: expected exactly one level-1 manager; found " + levelOnes.length);
  }

  const owner = owners[0];
  const l1 = levelOnes[0];
  if (owner && (owner.reportsTo !== null || owner.status !== "active")) {
    errors.push('owner "' + owner.id + '": must be active and have no reporting parent');
  }
  if (owner && unitById.get(owner.unitId)?.kind !== "root") {
    errors.push('owner "' + owner.id + '": must belong to the root unit');
  }
  if (owner && l1 && l1.reportsTo !== owner.id) {
    errors.push('level-1 manager "' + l1.id + '": must report to the owner');
  }
  if (l1 && unitById.get(l1.unitId)?.level !== 1) {
    errors.push('level-1 manager "' + l1.id + '": must belong to a level-1 core unit');
  }

  const l2ByUnit = new Map();
  for (const agent of registry.agents.filter(
    item => item?.level === 2 && item?.positionKind === "l2_manager",
  )) {
    const items = l2ByUnit.get(agent.unitId) ?? [];
    items.push(agent);
    l2ByUnit.set(agent.unitId, items);
    if (l1 && agent.reportsTo !== l1.id) {
      errors.push('level-2 manager "' + agent.id + '": must report to level 1');
    }
    if (unitById.get(agent.unitId)?.level !== 2) {
      errors.push('level-2 manager "' + agent.id + '": must belong to a level-2 domain unit');
    }
  }
  for (const unit of registry.units.filter(
    item => item?.level === 2 && item?.kind === "domain",
  )) {
    const managers = l2ByUnit.get(unit.id) ?? [];
    if (managers.length !== 1) {
      errors.push('domain "' + unit.id + '": expected exactly one level-2 manager; found ' + managers.length);
    }
  }

  // Every level-3 agent must report to a manager in its own domain.
  const l3Managers = registry.agents.filter(
    agent => agent?.level === 3 && agent?.positionKind === "l3_manager",
  );
  for (const agent of registry.agents.filter(item => item?.level === 3)) {
    const parent = agentById.get(agent.reportsTo);
    if (!parent || ![2, 3].includes(parent.level)) {
      errors.push('level-3 agent "' + agent.id + '": reporting manager does not exist');
      continue;
    }
    if (parent.unitId !== agent.unitId) {
      errors.push('level-3 agent "' + agent.id + '": reporting manager must be in the same domain');
    }
    if (parent.level === 2 && parent.positionKind !== "l2_manager") {
      errors.push('level-3 agent "' + agent.id + '": level-2 parent must be a domain manager');
    }
    if (
      parent.level === 3 &&
      (parent.positionKind !== "l3_manager" ||
        !Array.isArray(parent.managerOf) ||
        !parent.managerOf.includes(agent.id))
    ) {
      errors.push('level-3 agent "' + agent.id + '": level-3 parent must explicitly manage this member');
    }
  }

  for (const manager of l3Managers) {
    if (!Array.isArray(manager.managerOf) || manager.managerOf.length === 0) {
      errors.push('level-3 manager "' + manager.id + '": managerOf must contain at least one member');
      continue;
    }
    for (const memberId of manager.managerOf) {
      const member = agentById.get(memberId);
      if (
        !member ||
        member.level !== 3 ||
        member.unitId !== manager.unitId ||
        member.reportsTo !== manager.id
      ) {
        errors.push('level-3 manager "' + manager.id + '": invalid managed member "' + memberId + '"');
      }
    }
  }

  // Level-2/level-3 peer communication and delegation stay inside one domain.
  for (const connection of registry.connections) {
    if (!isRecord(connection)) {
      errors.push("connections: each entry must be an object");
      continue;
    }
    const source = agentById.get(connection.from);
    const target = agentById.get(connection.to);
    if (!source) errors.push('connection: source "' + connection.from + '" does not exist');
    if (!target) errors.push('connection: target "' + connection.to + '" does not exist');
    if (source && target) {
      if (source.id === target.id) {
        errors.push('connection: self-connection "' + source.id + '" is not permitted');
      }
      if (source.level >= 2 && target.level >= 2 && source.unitId !== target.unitId) {
        errors.push('connection: cross-domain peer access "' + source.id + '" -> "' + target.id + '" is not permitted');
      }
    }
  }

  // Level 1 may assign directly to level 3 only when the responsible manager is notified.
  for (const assignment of registry.assignments) {
    if (!isRecord(assignment)) {
      errors.push("assignments: each entry must be an object");
      continue;
    }
    const source = agentById.get(assignment.sourceAgentId);
    const target = agentById.get(assignment.targetAgentId);
    if (!source) errors.push('assignment: source "' + assignment.sourceAgentId + '" does not exist');
    if (!target) errors.push('assignment: target "' + assignment.targetAgentId + '" does not exist');
    if (!source || !target) continue;
    if (source.level >= target.level) {
      errors.push('assignment: "' + source.id + '" cannot assign to same or higher level "' + target.id + '"');
    }
    if (source.level === 1 && target.level === 3) {
      const targetManager = agentById.get(target.reportsTo);
      if (
        targetManager?.level !== 2 ||
        targetManager.unitId !== target.unitId ||
        assignment.notifyTargetManager !== true
      ) {
        errors.push('assignment: level-1 direct assignment to "' + target.id + '" must notify its domain manager');
      }
    }
    if (
      source.level === 2 &&
      (source.unitId !== target.unitId || target.reportsTo !== source.id)
    ) {
      errors.push('assignment: level-2 manager "' + source.id + '" may only assign a direct report in its own domain');
    }
    if (source.level === 3) {
      if (
        source.positionKind !== "l3_manager" ||
        source.unitId !== target.unitId ||
        !Array.isArray(source.managerOf) ||
        !source.managerOf.includes(target.id)
      ) {
        errors.push('assignment: level-3 source "' + source.id + '" is not the verified manager of "' + target.id + '"');
      }
    }
  }

  // Policy codes/priorities must be unique and protected actions must fail closed.
  addUniqueErrors(registry.policies, "code", "policies", errors);
  const priorities = new Set();
  for (const policy of registry.policies) {
    if (!isRecord(policy)) {
      errors.push("policies: each entry must be an object");
      continue;
    }
    if (!Number.isInteger(policy.priority) || policy.priority < 0) {
      errors.push('policy "' + policy.code + '": priority must be a non-negative integer');
    } else if (priorities.has(policy.priority)) {
      errors.push('policies: duplicate priority "' + policy.priority + '"');
    } else {
      priorities.add(policy.priority);
    }
    if (!["allow", "deny", "approval_required"].includes(policy.decision)) {
      errors.push('policy "' + policy.code + '": invalid decision');
    }
    if (!["any", "same", "different"].includes(policy.domainCondition)) {
      errors.push('policy "' + policy.code + '": invalid domainCondition');
    }
    if (
      !Array.isArray(policy.actionSet) ||
      policy.actionSet.length === 0 ||
      !policy.actionSet.every(action => typeof action === "string" && action.length > 0) ||
      new Set(policy.actionSet).size !== policy.actionSet.length
    ) {
      errors.push('policy "' + policy.code + '": actionSet must contain unique non-empty strings');
    }
    for (const key of ["sourceLevels", "targetLevels"]) {
      if (
        !Array.isArray(policy[key]) ||
        !policy[key].every(level => Number.isInteger(level) && level >= 0 && level <= 3) ||
        new Set(policy[key]).size !== policy[key].length
      ) {
        errors.push('policy "' + policy.code + '": ' + key + ' must contain unique levels from 0 to 3');
      }
    }
  }

  const rulesFor = action =>
    registry.policies.filter(
      policy => Array.isArray(policy?.actionSet) && policy.actionSet.includes(action),
    );
  for (const action of registry.forbiddenActions) {
    const rules = rulesFor(action);
    if (!rules.some(rule => rule.decision === "deny")) {
      errors.push('forbidden action "' + action + '": no deny rule covers this action');
    }
    if (rules.some(rule => rule.decision !== "deny")) {
      errors.push('forbidden action "' + action + '": a non-deny rule creates an override risk');
    }
  }
  for (const action of registry.sensitiveActions) {
    const rules = rulesFor(action);
    if (!rules.some(rule => rule.decision === "approval_required")) {
      errors.push('sensitive action "' + action + '": no approval-required rule covers this action');
    }
    if (rules.some(rule => rule.decision === "allow")) {
      errors.push('sensitive action "' + action + '": an allow rule bypasses approval');
    }
  }

  return {valid: errors.length === 0, errors};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const inputPath = resolve(process.argv[2] ?? defaultFixture);
  try {
    const registry = JSON.parse(readFileSync(inputPath, "utf8"));
    const result = validateRegistry(registry);
    if (!result.valid) {
      process.stderr.write(JSON.stringify(result, null, 2) + "\n");
      process.exitCode = 1;
    } else {
      process.stdout.write(JSON.stringify({valid: true, source: inputPath}, null, 2) + "\n");
    }
  } catch (error) {
    process.stderr.write(
      "Unable to validate registry: " +
        (error instanceof Error ? error.message : "unknown error") +
        "\n",
    );
    process.exitCode = 1;
  }
}

export {validateRegistry};
