/** Copying owns a temporary write lease, not project retirement or editor history. */
export async function prepareProjectCopy(input: {
  freeze(): () => void;
  flushFields(): void;
  drain(): Promise<void>;
  flushDocument(): void;
  save(): Promise<void>;
}): Promise<() => void> {
  const thaw = input.freeze();
  let released = false;
  const release = () => { if (!released) { released = true; thaw(); } };
  try {
    input.flushFields();
    await input.drain();
    input.flushDocument();
    await input.save();
    return release;
  } catch (error) { release(); throw error; }
}
