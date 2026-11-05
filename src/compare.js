import { generateWorkload, scheduleTasks } from "./cloud-scheduler.js";
import { batScheduler, fireflyScheduler } from "./metaheuristics.js";

function summarize(values) {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return {
    best: Math.min(...values),
    mean,
    worst: Math.max(...values),
    stdDev: Math.sqrt(variance),
  };
}

/**
 * Run Min-Min (deterministic baseline), FA and BA on identical workloads.
 * For run k, the workload uses seed + k; FA and BA receive the same population
 * size and evaluation budget and distinct but reproducible algorithm seeds.
 */
export function compareAlgorithms({
  taskCount,
  vmCount,
  seed,
  runs = 10,
  populationSize = 30,
  maxEvaluations = 6_000,
  ...workloadRange
}) {
  if (!Number.isSafeInteger(runs) || runs < 1) {
    throw new RangeError("runs must be a positive integer");
  }
  const samples = { "Min-Min": [], FA: [], BA: [] };
  const balance = { "Min-Min": [], FA: [], BA: [] };

  for (let run = 0; run < runs; run += 1) {
    const { tasks, vms } = generateWorkload({
      taskCount, vmCount, seed: seed + run, ...workloadRange,
    });
    const options = { populationSize, maxEvaluations };
    const results = {
      "Min-Min": scheduleTasks(tasks, vms),
      FA: fireflyScheduler(tasks, vms, { ...options, seed: seed + run }),
      BA: batScheduler(tasks, vms, { ...options, seed: seed + run }),
    };
    for (const [name, result] of Object.entries(results)) {
      samples[name].push(result.makespan);
      balance[name].push(result.loadBalance.coefficientOfVariation);
    }
  }

  const baselineMean = summarize(samples["Min-Min"]).mean;
  return {
    config: { taskCount, vmCount, seed, runs, populationSize, maxEvaluations },
    algorithms: Object.keys(samples).map((name) => {
      const makespan = summarize(samples[name]);
      return {
        algorithm: name,
        makespan,
        meanCoefficientOfVariation: summarize(balance[name]).mean,
        improvementOverMinMin: baselineMean === 0 ? 0 : (baselineMean - makespan.mean) / baselineMean,
      };
    }),
  };
}