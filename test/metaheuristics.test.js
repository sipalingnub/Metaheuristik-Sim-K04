import assert from "node:assert/strict";
import test from "node:test";
import { generateWorkload, scheduleTasks } from "../src/cloud-scheduler.js";
import { batScheduler, fireflyScheduler } from "../src/metaheuristics.js";
import { compareAlgorithms } from "../src/compare.js";

const workload = generateWorkload({ taskCount: 30, vmCount: 4, seed: 11 });
const options = { seed: 5, populationSize: 10, maxEvaluations: 500 };

for (const [name, run] of [["FA", fireflyScheduler], ["BA", batScheduler]]) {
  test(`${name} returns a valid complete schedule`, () => {
    const result = run(workload.tasks, workload.vms, options);
    assert.equal(result.algorithm, name);
    assert.equal(result.assignments.length, workload.tasks.length);
    assert.deepEqual(
      new Set(result.assignments.map((a) => a.taskId)),
      new Set(workload.tasks.map((t) => t.id)),
    );
    const finishes = result.vmLoads.map((l) => l.totalExecutionTime);
    assert.equal(result.makespan, Math.max(...finishes));
    assert.ok(result.evaluations <= options.maxEvaluations);
    assert.ok(result.loadBalance.minMaxRatio >= 0 && result.loadBalance.minMaxRatio <= 1);
  });

  test(`${name} is reproducible for the same seed`, () => {
    assert.deepEqual(run(workload.tasks, workload.vms, options), run(workload.tasks, workload.vms, options));
  });

  test(`${name} convergence never gets worse`, () => {
    const { convergence } = run(workload.tasks, workload.vms, options);
    for (let i = 1; i < convergence.length; i += 1) {
      assert.ok(convergence[i] <= convergence[i - 1]);
    }
  });

  test(`${name} handles empty tasks, one VM, and invalid options`, () => {
    assert.equal(run([], workload.vms, options).makespan, 0);
    const single = run(workload.tasks, [{ id: "only", mips: 100 }], options);
    assert.equal(single.assignments.length, workload.tasks.length);
    assert.throws(() => run(workload.tasks, workload.vms, { ...options, populationSize: 1 }), /populationSize/);
    assert.throws(() => run(workload.tasks, workload.vms, { ...options, maxEvaluations: 3 }), /maxEvaluations/);
    assert.throws(() => run(workload.tasks, workload.vms, { ...options, seed: -1 }), /seed/);
    assert.throws(() => run(workload.tasks, [], options), /At least one VM/);
  });
}

test("FA and BA beat a trivial all-on-one-VM schedule", () => {
  const serial = workload.tasks.reduce((sum, t) => sum + t.mi / workload.vms[0].mips, 0);
  assert.ok(fireflyScheduler(workload.tasks, workload.vms, options).makespan < serial);
  assert.ok(batScheduler(workload.tasks, workload.vms, options).makespan < serial);
});

test("compareAlgorithms uses the same workload and budget for all algorithms", () => {
  const config = { taskCount: 20, vmCount: 3, seed: 3, runs: 3, populationSize: 10, maxEvaluations: 300 };
  const report = compareAlgorithms(config);
  assert.deepEqual(report.algorithms.map((a) => a.algorithm), ["Min-Min", "FA", "BA"]);
  assert.equal(report.algorithms[0].improvementOverMinMin, 0);
  const expected = scheduleTasks(
    generateWorkload({ ...config, seed: 3 }).tasks,
    generateWorkload({ ...config, seed: 3 }).vms,
  ).makespan;
  assert.ok(report.algorithms[0].makespan.best <= expected + 1e-9);
  assert.deepEqual(report, compareAlgorithms(config));
  assert.throws(() => compareAlgorithms({ ...config, runs: 0 }), /runs/);
});