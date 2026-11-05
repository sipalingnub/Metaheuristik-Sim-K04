import assert from "node:assert/strict";
import test from "node:test";
import {
  generateWorkload,
  scheduleTasks,
  simulateCloudEnvironment,
} from "../src/cloud-scheduler.js";

test("execution time is MI divided by VM MIPS", () => {
  const result = scheduleTasks([{ id: "task-1", mi: 1_200 }], [
    { id: "vm-1", mips: 600 },
  ]);

  assert.equal(result.assignments[0].executionTime, 2);
  assert.equal(result.assignments[0].finishTime, 2);
  assert.equal(result.makespan, 2);
});

test("Min-Min assigns the task with the earliest completion first", () => {
  const result = scheduleTasks([
    { id: "large", mi: 8 },
    { id: "small", mi: 2 },
  ], [
    { id: "slow", mips: 1 },
    { id: "fast", mips: 2 },
  ]);

  assert.deepEqual(result.assignments.map(({ taskId, vmId }) => [taskId, vmId]), [
    ["small", "fast"],
    ["large", "fast"],
  ]);
  assert.equal(result.makespan, 5);
  assert.equal(result.vmLoads[1].totalExecutionTime, 5);
  assert.ok(result.loadBalance.minMaxRatio >= 0 && result.loadBalance.minMaxRatio <= 1);
  assert.ok(result.loadBalance.coefficientOfVariation >= 0);
});

test("empty task sets have zero makespan and balanced idle VMs", () => {
  const result = scheduleTasks([], [
    { id: "vm-1", mips: 500 },
    { id: "vm-2", mips: 2_000 },
  ]);

  assert.deepEqual(result.assignments, []);
  assert.equal(result.makespan, 0);
  assert.deepEqual(result.loadBalance, {
    minMaxRatio: 1,
    coefficientOfVariation: 0,
  });
  assert.deepEqual(result.vmLoads.map(({ totalExecutionTime }) => totalExecutionTime), [0, 0]);
});

test("zero-length tasks are accepted and assigned without increasing makespan", () => {
  const result = scheduleTasks([{ id: "instant", mi: 0 }], [
    { id: "vm-1", mips: 1 },
  ]);

  assert.equal(result.assignments[0].executionTime, 0);
  assert.equal(result.makespan, 0);
});

test("invalid inputs and duplicate identifiers are rejected", () => {
  assert.throws(() => scheduleTasks([], []), /At least one VM/);
  assert.throws(
    () => scheduleTasks([{ id: "task", mi: -1 }], [{ id: "vm", mips: 1 }]),
    /finite non-negative/,
  );
  assert.throws(
    () => scheduleTasks([{ id: "task", mi: 1 }], [{ id: "vm", mips: 0 }]),
    /finite positive/,
  );
  assert.throws(
    () => scheduleTasks([{ id: "task", mi: Number.MAX_VALUE }], [{ id: "vm", mips: Number.MIN_VALUE }]),
    /execution and completion times must be finite/,
  );
  assert.throws(
    () => scheduleTasks([{ id: "task", mi: 1 }, { id: "task", mi: 2 }], [{ id: "vm", mips: 1 }]),
    /unique ids/,
  );
});

test("same seed reproduces workload and complete simulation", () => {
  const options = { taskCount: 12, vmCount: 4, seed: 42 };
  assert.deepEqual(generateWorkload(options), generateWorkload(options));
  assert.deepEqual(
    simulateCloudEnvironment(options),
    simulateCloudEnvironment(options),
  );
  assert.notDeepEqual(
    generateWorkload(options),
    generateWorkload({ ...options, seed: 43 }),
  );
});

test("workload generation supports zero tasks and fixed range bounds", () => {
  assert.deepEqual(generateWorkload({
    taskCount: 0,
    vmCount: 1,
    seed: 0,
    minMi: 5,
    maxMi: 5,
    minMips: 700,
    maxMips: 700,
  }), {
    seed: 0,
    tasks: [],
    vms: [{ id: "vm-1", mips: 700 }],
  });
});

test("generated workloads contain heterogeneous VM capacities", () => {
  const { vms } = generateWorkload({
    taskCount: 1,
    vmCount: 3,
    seed: 7,
    minMips: 500,
    maxMips: 2_000,
  });

  assert.equal(vms[0].mips, 500);
  assert.equal(vms[1].mips, 2_000);
});

test("invalid workload configuration is rejected", () => {
  assert.throws(() => generateWorkload({ taskCount: -1, vmCount: 1, seed: 1 }), /taskCount/);
  assert.throws(() => generateWorkload({ taskCount: 1, vmCount: 0, seed: 1 }), /vmCount/);
  assert.throws(() => generateWorkload({ taskCount: 1, vmCount: 1, seed: -1 }), /seed/);
  assert.throws(
    () => generateWorkload({ taskCount: 1, vmCount: 1, seed: 1, minMi: 10, maxMi: 9 }),
    /maxMi/,
  );
  assert.throws(
    () => generateWorkload({ taskCount: 1, vmCount: 2, seed: 1, minMips: 500, maxMips: 500 }),
    /heterogeneous VMs/,
  );
});