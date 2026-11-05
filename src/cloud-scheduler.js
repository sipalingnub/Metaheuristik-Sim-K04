function assertIntegerInRange(value, name, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

function assertNonNegativeFinite(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
}

export function validateEntities(entities, name, valueName, allowZero) {
  if (!Array.isArray(entities)) {
    throw new TypeError(`${name} must be an array`);
  }

  const ids = new Set();
  for (const entity of entities) {
    if (entity === null || typeof entity !== "object") {
      throw new TypeError(`Each ${name.slice(0, -1)} must be an object`);
    }
    if (typeof entity.id !== "string" || entity.id.length === 0) {
      throw new TypeError(`Each ${name.slice(0, -1)} must have a non-empty string id`);
    }
    if (ids.has(entity.id)) {
      throw new RangeError(`${name} must have unique ids`);
    }
    ids.add(entity.id);

    const value = entity[valueName];
    if (allowZero) {
      assertNonNegativeFinite(value, `${name}.${valueName}`);
    } else if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError(`${name}.${valueName} must be a finite positive number`);
    }
  }
}

export function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInteger(random, minimum, maximum) {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

export function generateWorkload({
  taskCount,
  vmCount,
  seed,
  minMi = 1_000,
  maxMi = 10_000,
  minMips = 500,
  maxMips = 4_000,
}) {
  assertIntegerInRange(taskCount, "taskCount", 0);
  assertIntegerInRange(vmCount, "vmCount", 1);
  assertIntegerInRange(seed, "seed", 0, 0xffff_ffff);
  assertIntegerInRange(minMi, "minMi", 1);
  assertIntegerInRange(maxMi, "maxMi", minMi);
  assertIntegerInRange(minMips, "minMips", 1);
  assertIntegerInRange(maxMips, "maxMips", minMips);
  if (vmCount > 1 && minMips === maxMips) {
    throw new RangeError("Multiple heterogeneous VMs require minMips to be less than maxMips");
  }

  const random = createRandom(seed);
  const tasks = Array.from({ length: taskCount }, (_, index) => ({
    id: `task-${index + 1}`,
    mi: randomInteger(random, minMi, maxMi),
  }));
  const vms = Array.from({ length: vmCount }, (_, index) => ({
    id: `vm-${index + 1}`,
    mips: index === 0
      ? minMips
      : index === 1
        ? maxMips
        : randomInteger(random, minMips, maxMips),
  }));

  return { seed, tasks, vms };
}

export function computeMakespan(loads) {
  return loads.reduce((maximum, load) => Math.max(maximum, load), 0);
}

export function computeLoadBalance(loads) {
  const makespan = computeMakespan(loads);
  const minimumLoad = loads.reduce((minimum, load) => Math.min(minimum, load), Number.POSITIVE_INFINITY);
  const meanLoad = loads.reduce((sum, load) => sum + load, 0) / loads.length;
  const variance = loads.reduce((sum, load) => sum + (load - meanLoad) ** 2, 0) / loads.length;
  return {
    minMaxRatio: makespan === 0 ? 1 : minimumLoad / makespan,
    coefficientOfVariation: meanLoad === 0 ? 0 : Math.sqrt(variance) / meanLoad,
  };
}

export function scheduleTasks(tasks, vms) {
  validateEntities(tasks, "tasks", "mi", true);
  validateEntities(vms, "vms", "mips", false);
  if (vms.length === 0) {
    throw new RangeError("At least one VM is required");
  }

  const vmLoads = vms.map((vm) => ({
    vmId: vm.id,
    totalExecutionTime: 0,
    taskCount: 0,
  }));
  const assignments = [];
  const remainingTasks = [...tasks];

  while (remainingTasks.length > 0) {
    let selectedTaskIndex = 0;
    let selectedVmIndex = 0;
    let selectedFinishTime = Number.POSITIVE_INFINITY;
    let selectedExecutionTime = 0;

    for (let taskIndex = 0; taskIndex < remainingTasks.length; taskIndex += 1) {
      const task = remainingTasks[taskIndex];
      for (let vmIndex = 0; vmIndex < vms.length; vmIndex += 1) {
        const executionTime = task.mi / vms[vmIndex].mips;
        const finishTime = vmLoads[vmIndex].totalExecutionTime + executionTime;
        if (!Number.isFinite(executionTime) || !Number.isFinite(finishTime)) {
          throw new RangeError("Task execution and completion times must be finite");
        }
        if (finishTime < selectedFinishTime) {
          selectedTaskIndex = taskIndex;
          selectedVmIndex = vmIndex;
          selectedFinishTime = finishTime;
          selectedExecutionTime = executionTime;
        }
      }
    }

    const [task] = remainingTasks.splice(selectedTaskIndex, 1);
    const vm = vms[selectedVmIndex];
    const vmLoad = vmLoads[selectedVmIndex];
    const startTime = vmLoad.totalExecutionTime;
    const finishTime = startTime + selectedExecutionTime;

    assignments.push({
      taskId: task.id,
      vmId: vm.id,
      executionTime: selectedExecutionTime,
      startTime,
      finishTime,
    });
    vmLoad.totalExecutionTime = finishTime;
    vmLoad.taskCount += 1;
  }

  return {
    assignments,
    vmLoads,
    makespan: computeMakespan(vmLoads.map((vm) => vm.totalExecutionTime)),
    loadBalance: computeLoadBalance(vmLoads.map((vm) => vm.totalExecutionTime)),
  };
}

export function simulateCloudEnvironment(options) {
  const workload = generateWorkload(options);
  return {
    ...workload,
    ...scheduleTasks(workload.tasks, workload.vms),
  };
}