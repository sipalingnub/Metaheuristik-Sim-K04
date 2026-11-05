# Metaheuristik-Sim-K04

## Cloud environment simulation

This project contains a JavaScript cloud-task scheduling model; it does not use
the CloudSim toolkit.

- A task has an instruction length in million instructions (`mi`, MI).
- A VM has a processing capacity in million instructions per second (`mips`,
  MIPS). Its task execution time is `mi / mips` seconds.
- `scheduleTasks` uses deterministic Min-Min scheduling: repeatedly select the
  task-VM pair with the earliest predicted finish time, using input order to
  break ties. Tasks assigned to a VM execute sequentially.
- The result reports the makespan (the maximum VM completion time), plus load
  balance as the minimum-to-maximum VM load ratio and the coefficient of
  variation of VM execution times.
- `generateWorkload` uses a seeded PRNG. Identical options and seed produce
  identical tasks and VMs. When generating multiple VMs, set a non-zero MIPS
  range; the first two VMs use its lower and upper bounds to guarantee
  heterogeneous capacities.

## Metaheuristic schedulers (FA and BA)

`src/metaheuristics.js` adds the Firefly Algorithm (`fireflyScheduler`) and the
Bat Algorithm (`batScheduler`). Both use the same model as Min-Min:

- **Encoding:** one continuous coordinate per task in `[0, vmCount)`; the
  floored value is the VM index.
- **Fitness:** makespan (lower is better), using `mi / mips` with sequential
  execution per VM.
- **Result shape:** same as `scheduleTasks`, plus `algorithm`, `evaluations`
  and a best-so-far `convergence` array.
- **Fair comparison:** identical workload, population size and total fitness
  evaluation budget (`maxEvaluations`, including the initial population);
  every run is seeded and reproducible. Min-Min is the deterministic baseline.

`compareAlgorithms` (`src/compare.js`) runs Min-Min, FA and BA over several
seeded workloads and reports best/mean/worst/std-dev makespan, load-balance CV
and the mean improvement over Min-Min. `npm run benchmark` prints tables for
three scenario sizes.

FA and BA are not guaranteed to beat Min-Min: with a fixed budget, quality
drops as the number of tasks and VMs grows. Tune `populationSize`,
`maxEvaluations` and algorithm parameters before drawing conclusions.

Run the tests with `npm test`.
