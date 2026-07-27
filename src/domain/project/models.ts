export interface Asset {
  id: string;
  sourcePath: string;
  name: string;
}

export interface TextBlock {
  id: string;
  content: string;
}

export interface Board {
  id: string;
  name: string;
  assets: Asset[];
  textBlocks: TextBlock[];
}

export interface Project {
  id: string;
  name: string;
  boards: Board[];
}

export function createEmptyProject(id: string, name: string): Project {
  return {
    id,
    name,
    boards: [
      {
        id: `${id}-board-1`,
        name: "Main board",
        assets: [],
        textBlocks: [],
      },
    ],
  };
}
