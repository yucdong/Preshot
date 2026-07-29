export interface ReferenceImage {
  id: string;
  file: string;
}

export interface ReferenceGroup {
  id: string;
  title: string;
  columnsPerRow: number;
  images: ReferenceImage[];
}

export interface ProjectPlan {
  referenceGroups: ReferenceGroup[];
}

export interface ImportedImage {
  file: string;
  dataUrl: string;
}

export const MIN_COLUMNS = 1;
export const MAX_COLUMNS = 6;
export const DEFAULT_COLUMNS = 3;

export const EMPTY_PLAN: ProjectPlan = {
  referenceGroups: [],
};
