import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, resolve} from "node:path";
import test from "node:test";

import {validateRegistry} from "../scripts/validate-registry.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "../fixtures/valid-registry.json");
const validRegistry = JSON.parse(readFileSync(fixturePath, "utf8"));
const clone = () => structuredClone(validRegistry);

function assertInvalid(registry, expectedText) {
  const result = validateRegistry(registry);
  assert.equal(result.valid, false, "expected registry validation to fail");
  assert.ok(
    result.errors.some(error => error.includes(expectedText)),
    'expected an error containing "' + expectedText + '", received:\n' +
      result.errors.join("\n"),
  );
}

test("accepts a complete, domain-separated registry", () => {
  assert.deepEqual(validateRegistry(validRegistry), {valid: true, errors: []});
});

test("rejects duplicate agent identifiers", () => {
  const registry = clone();
  registry.agents.push({...registry.agents[2]});
  assertInvalid(registry, 'duplicate id "alpha-manager"');
});

test("requires exactly one active human owner", () => {
  const registry = clone();
  registry.agents = registry.agents.filter(agent => agent.id !== "owner");
  assertInvalid(registry, "expected exactly one level-0 owner");
});

test("requires the central manager to report to the owner", () => {
  const registry = clone();
  registry.agents.find(agent => agent.id === "central-manager").reportsTo = "unknown";
  assertInvalid(registry, "must report to the owner");
});

test("rejects orphaned unit references", () => {
  const registry = clone();
  registry.agents.find(agent => agent.id === "alpha-specialist").unitId = "missing-domain";
  assertInvalid(registry, 'unit "missing-domain" does not exist');
});

test("requires one level-2 manager for every domain", () => {
  const registry = clone();
  registry.agents = registry.agents.filter(agent => agent.id !== "beta-manager");
  assertInvalid(registry, 'domain "domain-beta": expected exactly one level-2 manager');
});

test("requires explicit level-3 specialist or manager classification", () => {
  const registry = clone();
  registry.agents.find(agent => agent.id === "alpha-specialist").positionKind = "unclassified";
  assertInvalid(registry, "positionKind does not match level 3");
});

test("requires level-3 agents to belong to level-2 domain units", () => {
  const registry = clone();
  registry.agents.find(agent => agent.id === "alpha-specialist").unitId = "central";
  assertInvalid(registry, "must belong to a level-2 domain unit");
});

test("rejects cross-domain peer access", () => {
  const registry = clone();
  registry.connections.push({
    from: "alpha-manager",
    to: "beta-manager",
    kind: "communication",
  });
  assertInvalid(registry, "cross-domain peer access");
});

test("requires notification on a direct level-1 assignment to level 3", () => {
  const registry = clone();
  registry.assignments[0].notifyTargetManager = false;
  assertInvalid(registry, "must notify its domain manager");
});

test("requires level-3 managers to have a reciprocal managed team", () => {
  const registry = clone();
  const manager = registry.agents.find(agent => agent.id === "alpha-specialist");
  manager.positionKind = "l3_manager";
  manager.managerOf = [];
  assertInvalid(registry, "managerOf must contain at least one member");
});

test("forbidden actions must remain denied", () => {
  const registry = clone();
  registry.policies.push({
    code: "allow-secret-read",
    priority: 20,
    decision: "allow",
    domainCondition: "any",
    actionSet: ["secret.read"],
    sourceLevels: [0, 1, 2, 3],
    targetLevels: [0, 1, 2, 3],
  });
  assertInvalid(registry, 'forbidden action "secret.read": a non-deny rule');
});

test("sensitive actions must require approval and cannot be allowed", () => {
  const registry = clone();
  registry.policies.push({
    code: "allow-policy-change",
    priority: 20,
    decision: "allow",
    domainCondition: "any",
    actionSet: ["policy.change"],
    sourceLevels: [0, 1, 2, 3],
    targetLevels: [0, 1, 2, 3],
  });
  assertInvalid(registry, 'sensitive action "policy.change": an allow rule');
});

test("rejects duplicate policy priorities", () => {
  const registry = clone();
  registry.policies[1].priority = registry.policies[0].priority;
  assertInvalid(registry, 'duplicate priority "0"');
});

test("rejects unit-parent cycles", () => {
  const registry = clone();
  registry.units.find(unit => unit.id === "central").parentId = "domain-alpha";
  registry.units.find(unit => unit.id === "domain-alpha").parentId = "central";
  assertInvalid(registry, "parent cycle detected");
});
