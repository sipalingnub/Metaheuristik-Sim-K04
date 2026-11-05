import {
  computeLoadBalance,
  computeMakespan,
  createRandom,
  validateEntities,
} from "./cloud-scheduler.js";

/*
 * Shared encoding and fitness for Firefly (FA) and Bat (BA) scheduling.
 *
 * A candidate is a continuous vector with one coordinate per task, each in
 * [0, vmCount). Decoding floors a coordinate to the index of the VM that runs
 * the task. Fitness is the makespan (lower is better), computed from the same
 * execution-time model as Min-Min (mi / mips, sequential per VM).
 *
 * Fair comparison: every algorithm receives the same workload, the same
 * population size, and the same evaluation budget (`maxEvaluations`, counting
 * the initial population). Each algorithm has its own seeded PRNG, so runs are
 * reproducible.
 */

const DEFAULTS = {
  populationSize: 30,
  maxEvaluations: 6_000,
};

function prepare(tasks, vms, options) {
  validateEntities(tasks, "tasks", "mi", true);
  validateEntities(vms, "vms", "mips", false);
  if (vms.length === 0) {
    throw new RangeError("At least one VM is required");
  }
  const config = { ...DEFAULTS, ...options };
  if (!Number.isSafeInteger(config.populationSize) || config.populationSize < 2) {
    throw new RangeError("populationSize must be an integer of at least 2");
  }
  if (!Number.isSafeInteger(config.maxEvaluations) || config.maxEvaluations < config.populationSize) {
    throw new RangeError("maxEvaluations must be an integer of at least populationSize");
  }
  if (!Number.isSafeInteger(config.seed) || config.seed < 0 || config.seed > 0xffff_ffff) {
    throw new RangeError("seed must be an integer between 0 and 4294967295");
  }
  return config;
}

function createProblem(tasks, vms) {
  const taskCount = tasks.length;
  const vmCount = vms.length;
  const mi = tasks.map((task) => task.mi);
  const mips = vms.map((vm) => vm.mips);
  const loads = new Float64Array(vmCount);
  let evaluations = 0;

  function decode(position, target = new Int32Array(taskCount)) {
    for (let t = 0; t < taskCount; t += 1) {
      target[t] = Math.min(vmCount - 1, Math.max(0, Math.floor(position[t])));
    }
    return target;
  }

  function clamp(position) {
    const upper = vmCount - Number.EPSILON * vmCount;
    for (let t = 0; t < taskCount; t += 1) {
      position[t] = Math.min(upper, Math.max(0, position[t]));
    }
    return position;
  }

  function evaluate(position) {
    evaluations += 1;
    loads.fill(0);
    for (let t = 0; t < taskCount; t += 1) {
      const vmIndex = Math.min(vmCount - 1, Math.max(0, Math.floor(position[t])));
      loads[vmIndex] += mi[t] / mips[vmIndex];
    }
    let makespan = 0;
    for (let v = 0; v < vmCount; v += 1) {
      if (loads[v] > makespan) makespan = loads[v];
    }
    return makespan;
  }

  return {
    taskCount,
    vmCount,
    decode,
    clamp,
    evaluate,
    get evaluations() {
      return evaluations;
    },
  };
}

/** Build a full schedule result (same shape as scheduleTasks) from a vector. */
export function buildSchedule(tasks, vms, vmIndexes) {
  const vmLoads = vms.map((vm) => ({ vmId: vm.id, totalExecutionTime: 0, taskCount: 0 }));
  const assignments = tasks.map((task, index) => {
    const vmIndex = vmIndexes[index];
    const vm = vms[vmIndex];
    const vmLoad = vmLoads[vmIndex];
    const executionTime = task.mi / vm.mips;
    const startTime = vmLoad.totalExecutionTime;
    vmLoad.totalExecutionTime = startTime + executionTime;
    vmLoad.taskCount += 1;
    return {
      taskId: task.id,
      vmId: vm.id,
      executionTime,
      startTime,
      finishTime: vmLoad.totalExecutionTime,
    };
  });
  const loads = vmLoads.map((vm) => vm.totalExecutionTime);
  return {
    assignments,
    vmLoads,
    makespan: computeMakespan(loads),
    loadBalance: computeLoadBalance(loads),
  };
}

function finish(name, tasks, vms, problem, best, convergence) {
  const schedule = buildSchedule(tasks, vms, problem.decode(best.position));
  return {
    algorithm: name,
    ...schedule,
    evaluations: problem.evaluations,
    convergence,
  };
}

function randomPosition(random, problem) {
  const position = new Float64Array(problem.taskCount);
  for (let t = 0; t < problem.taskCount; t += 1) {
    position[t] = random() * problem.vmCount;
  }
  return position;
}

function trivialResult(name, tasks, vms) {
  return {
    algorithm: name,
    ...buildSchedule(tasks, vms, new Int32Array(tasks.length)),
    evaluations: 0,
    convergence: [],
  };
}

/**
 * Firefly Algorithm. Brightness = 1 / makespan. A dimmer firefly moves toward
 * every brighter one with attractiveness beta0 * exp(-gamma * r^2) (r is the
 * root-mean-square distance in normalised coordinates) plus a random step that
 * shrinks over iterations. The brightest firefly performs a random walk.
 */
export function fireflyScheduler(tasks, vms, options = {}) {
  const config = prepare(tasks, vms, options);
  if (tasks.length === 0 || vms.length === 1) return trivialResult("FA", tasks, vms);

  const { populationSize, maxEvaluations } = config;
  const { beta0 = 0.5, gamma = 1, alpha = 1, alphaDecay = 0.99 } = config;
  const mutationRate = Math.min(1, (config.mutationCount ?? 3) / tasks.length);
  const random = createRandom(config.seed);
  const problem = createProblem(tasks, vms);
  const { taskCount, vmCount } = problem;

  let swarm = Array.from({ length: populationSize }, () => {
    const position = randomPosition(random, problem);
    return { position, cost: problem.evaluate(position) };
  });
  let best = swarm.reduce((a, b) => (b.cost < a.cost ? b : a));
  best = { position: Float64Array.from(best.position), cost: best.cost };
  const convergence = [best.cost];
  let step = alpha;

  while (problem.evaluations + populationSize <= maxEvaluations) {
    const previous = swarm;
    const brightest = previous.reduce((a, b) => (b.cost < a.cost ? b : a));
    swarm = previous.map((firefly) => {
      const position = Float64Array.from(firefly.position);
      for (let j = 0; j < previous.length; j += 1) {
        const other = previous[j];
        if (!(other.cost < firefly.cost)) continue;
        let squared = 0;
        for (let t = 0; t < taskCount; t += 1) {
          const diff = (other.position[t] - position[t]) / vmCount;
          squared += diff * diff;
        }
        const beta = beta0 * Math.exp(-gamma * (squared / taskCount));
        for (let t = 0; t < taskCount; t += 1) {
          position[t] += beta * (other.position[t] - position[t]);
        }
      }
      {
        // Every firefly also takes a sparse random step (a few tasks change VM).
        for (let t = 0; t < taskCount; t += 1) {
          if (random() < mutationRate) {
            position[t] += step * (random() - 0.5) * 2 * vmCount;
          }
        }
      }
      problem.clamp(position);
      return { position, cost: problem.evaluate(position) };
    });
    // Elitism: keep the best firefly found so far in the swarm.
    const worstIndex = swarm.reduce((w, f, i) => (f.cost > swarm[w].cost ? i : w), 0);
    const currentBest = swarm.reduce((a, b) => (b.cost < a.cost ? b : a));
    if (currentBest.cost < best.cost) {
      best = { position: Float64Array.from(currentBest.position), cost: currentBest.cost };
    } else if (brightest.cost <= best.cost) {
      swarm[worstIndex] = { position: Float64Array.from(best.position), cost: best.cost };
    }
    step *= alphaDecay;
    convergence.push(best.cost);
  }

  return finish("FA", tasks, vms, problem, best, convergence);
}

/**
 * Bat Algorithm. Each bat has a frequency, velocity, loudness A and pulse
 * emission rate r. Global moves pull bats toward the best bat; with
 * probability (1 - r) a bat instead walks locally around the best solution.
 * A candidate is accepted when it improves the bat and a random number is
 * below A; then A decays and r grows.
 */
export function batScheduler(tasks, vms, options = {}) {
  const config = prepare(tasks, vms, options);
  if (tasks.length === 0 || vms.length === 1) return trivialResult("BA", tasks, vms);

  const { populationSize, maxEvaluations } = config;
  const {
    fMin = 0, fMax = 2, loudness0 = 0.9, pulseRate0 = 0.5, alphaLoud = 0.95, gammaPulse = 0.05,
  } = config;
  const random = createRandom(config.seed);
  const problem = createProblem(tasks, vms);
  const { taskCount, vmCount } = problem;
  const mutationRate = Math.min(1, (config.mutationCount ?? 3) / taskCount);

  const bats = Array.from({ length: populationSize }, () => {
    const position = randomPosition(random, problem);
    return {
      position,
      velocity: new Float64Array(taskCount),
      cost: problem.evaluate(position),
      loudness: loudness0,
      pulseRate: 0,
    };
  });
  let best = bats.reduce((a, b) => (b.cost < a.cost ? b : a));
  best = { position: Float64Array.from(best.position), cost: best.cost };
  const convergence = [best.cost];
  let iteration = 0;

  while (problem.evaluations + populationSize <= maxEvaluations) {
    iteration += 1;
    const meanLoudness = bats.reduce((sum, bat) => sum + bat.loudness, 0) / bats.length;
    for (const bat of bats) {
      const frequency = fMin + (fMax - fMin) * random();
      const candidate = new Float64Array(taskCount);
      const velocity = new Float64Array(taskCount);
      for (let t = 0; t < taskCount; t += 1) {
        velocity[t] = bat.velocity[t] + (bat.position[t] - best.position[t]) * frequency;
        velocity[t] = Math.max(-vmCount, Math.min(vmCount, velocity[t]));
        candidate[t] = bat.position[t] + velocity[t];
      }
      if (random() > bat.pulseRate) {
        candidate.set(best.position);
        for (let t = 0; t < taskCount; t += 1) {
          if (random() < mutationRate) {
            candidate[t] += (random() * 2 - 1) * meanLoudness * vmCount;
          }
        }
      }
      problem.clamp(candidate);
      const cost = problem.evaluate(candidate);
      if (cost <= bat.cost && random() < bat.loudness) {
        bat.position = candidate;
        bat.velocity = velocity;
        bat.cost = cost;
        bat.loudness *= alphaLoud;
        bat.pulseRate = pulseRate0 * (1 - Math.exp(-gammaPulse * iteration));
      }
      if (cost < best.cost) {
        best = { position: Float64Array.from(candidate), cost };
      }
    }
    convergence.push(best.cost);
  }

  return finish("BA", tasks, vms, problem, best, convergence);
}