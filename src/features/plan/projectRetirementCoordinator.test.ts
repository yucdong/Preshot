import { describe, expect, it } from "vitest";
import type { CanvasPlanService } from "../../domain/plan/canvas/service";
import { getProjectRetirementCoordinator } from "./projectRetirementCoordinator";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function service(): CanvasPlanService {
  return {
    loadPlan: async () => ({ status: "missing" }),
    loadImage: async () => "",
    importAsset: async () => {
      throw new Error("Not used by retirement coordination tests.");
    },
    savePlan: async () => {},
    importImage: async () => {
      throw new Error("Not used by retirement coordination tests.");
    },
    importImages: async () => {
      throw new Error("Not used by retirement coordination tests.");
    },
    removeImage: async () => {
      throw new Error("Not used by retirement coordination tests.");
    },
    removeComponent: async () => {
      throw new Error("Not used by retirement coordination tests.");
    },
  };
}

describe("project retirement coordinator", () => {
  it("shares a project's latest retirement barrier and retains it until the matching queued retirement settles", async () => {
    const canvasService = service();
    const firstGate = deferred<void>();
    const secondGate = deferred<void>();
    const firstCoordinator = getProjectRetirementCoordinator(canvasService);
    const remountedCoordinator = getProjectRetirementCoordinator(canvasService);
    let secondStarted = false;

    const first = firstCoordinator.queue("C:\\shoots\\Demo", async () => {
      await firstGate.promise;
    });
    const second = firstCoordinator.queue("C:\\shoots\\Demo", async () => {
      secondStarted = true;
      await secondGate.promise;
    });

    expect(remountedCoordinator).toBe(firstCoordinator);

    let barrierSettled = false;
    void remountedCoordinator
      .waitFor("C:\\shoots\\Demo")
      .then(() => {
        barrierSettled = true;
      });

    firstGate.resolve();
    await first;
    await Promise.resolve();

    expect(secondStarted).toBe(true);
    expect(barrierSettled).toBe(false);

    secondGate.resolve();
    await second;
    await remountedCoordinator.waitFor("C:\\shoots\\Demo");

    expect(barrierSettled).toBe(true);
  });

  it("does not leak a retirement barrier to a different service instance", async () => {
    const firstService = service();
    const secondService = service();
    const gate = deferred<void>();
    const firstCoordinator = getProjectRetirementCoordinator(firstService);
    const secondCoordinator = getProjectRetirementCoordinator(secondService);
    let otherServiceWaited = false;

    const retirement = firstCoordinator.queue("C:\\shoots\\Demo", async () => {
      await gate.promise;
    });
    await secondCoordinator.waitFor("C:\\shoots\\Demo");
    otherServiceWaited = true;

    expect(otherServiceWaited).toBe(true);

    gate.resolve();
    await retirement;
  });

  it("propagates a retirement failure and clears its settled barrier for a later retry", async () => {
    const coordinator = getProjectRetirementCoordinator(service());
    const error = new Error("retirement failed");

    await expect(
      coordinator.queue("C:\\shoots\\Demo", async () => {
        throw error;
      }),
    ).rejects.toThrow(error);

    await coordinator.waitFor("C:\\shoots\\Demo");
  });

  it("runs a retirement queued before an earlier retirement fails", async () => {
    const coordinator = getProjectRetirementCoordinator(service());
    const error = new Error("first retirement failed");
    const completed: string[] = [];

    const first = coordinator.queue("C:\\shoots\\First", async () => {
      throw error;
    });
    const second = coordinator.queue("C:\\shoots\\Second", async () => {
      completed.push("second");
    });

    await expect(first).rejects.toThrow(error);
    await second;

    expect(completed).toEqual(["second"]);
  });
});
