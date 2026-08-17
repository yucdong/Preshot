class ProjectRetirementCoordinator {
  private readonly barriers = new Map<string, Promise<void>>();
  private sequencingTail: Promise<void> = Promise.resolve();
  private latestRetirement: Promise<void> = Promise.resolve();

  queue(projectPath: string, operation: () => Promise<void>): Promise<void> {
    const retirement = this.sequencingTail.then(operation);
    this.sequencingTail = retirement.then(
      () => undefined,
      () => undefined,
    );
    this.latestRetirement = retirement;
    this.barriers.set(projectPath, retirement);

    const clearIfCurrent = () => {
      if (this.barriers.get(projectPath) === retirement) {
        this.barriers.delete(projectPath);
      }
      if (this.latestRetirement === retirement) {
        this.latestRetirement = Promise.resolve();
      }
    };
    void retirement.then(clearIfCurrent, clearIfCurrent);

    return retirement;
  }

  waitFor(projectPath: string): Promise<void> {
    return this.barriers.get(projectPath) ?? Promise.resolve();
  }

  waitForRetirements(): Promise<void> {
    return this.latestRetirement;
  }
}

const coordinators = new WeakMap<object, ProjectRetirementCoordinator>();

export function getProjectRetirementCoordinator(
  service: object,
): ProjectRetirementCoordinator {
  let coordinator = coordinators.get(service);
  if (!coordinator) {
    coordinator = new ProjectRetirementCoordinator();
    coordinators.set(service, coordinator);
  }
  return coordinator;
}
