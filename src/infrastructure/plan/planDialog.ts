import { open } from "@tauri-apps/plugin-dialog";
import type { PlanImagePicker } from "../../domain/plan/ports";

type OpenDialog = (options: {
  title: string;
  directory: false;
  multiple: false;
  filters: { name: string; extensions: string[] }[];
}) => Promise<string | string[] | null>;

interface Dependencies {
  openDialog?: OpenDialog;
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createPlanImagePicker({ openDialog = open }: Dependencies = {}): PlanImagePicker {
  return {
    async pickImageFile(title) {
      let selected: string | string[] | null;
      try {
        selected = await openDialog({
          title,
          directory: false,
          multiple: false,
          filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png"] }],
        });
      } catch (error) {
        throw new Error(`Unable to select an image: ${detail(error)}`, { cause: error });
      }
      if (typeof selected === "string") {
        return selected;
      }
      if (selected === null) {
        return null;
      }
      throw new Error("Unable to select an image: Unexpected dialog response");
    },
  };
}

export const planImagePicker = createPlanImagePicker();
