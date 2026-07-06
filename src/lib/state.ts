import type { SelectedServer } from '@types';

interface StateFile {
  updatedAt: string;
  selected: SelectedServer[];
}

/** Persist the currently selected servers (outbound + last metrics) */
export async function saveSelected(
  path: string,
  selected: SelectedServer[]
): Promise<void> {
  const data: StateFile = { updatedAt: new Date().toISOString(), selected };
  await Bun.write(path, JSON.stringify(data, null, '\t'));
}

/** Load previously selected servers, or null if no valid state exists */
export async function loadSelected(
  path: string
): Promise<SelectedServer[] | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  try {
    const data = (await file.json()) as Partial<StateFile>;
    return Array.isArray(data.selected) ? data.selected : null;
  } catch {
    return null;
  }
}
