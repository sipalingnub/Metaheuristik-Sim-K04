import { compareAlgorithms } from "./compare.js";

const scenarios = [
  { taskCount: 50, vmCount: 5, seed: 1 },
  { taskCount: 100, vmCount: 10, seed: 1 },
  { taskCount: 200, vmCount: 20, seed: 1 },
];

for (const scenario of scenarios) {
  const { config, algorithms } = compareAlgorithms({ ...scenario, runs: 10 });
  console.log(`\n${config.taskCount} tasks, ${config.vmCount} VMs, ${config.runs} runs, `
    + `${config.maxEvaluations} evaluations, population ${config.populationSize}`);
  console.table(algorithms.map((a) => ({
    algorithm: a.algorithm,
    best: +a.makespan.best.toFixed(3),
    mean: +a.makespan.mean.toFixed(3),
    worst: +a.makespan.worst.toFixed(3),
    stdDev: +a.makespan.stdDev.toFixed(3),
    cv: +a.meanCoefficientOfVariation.toFixed(3),
    "vs Min-Min %": +(a.improvementOverMinMin * 100).toFixed(2),
  })));
}