import type { MaterialKind, MaterialPayload, PortableComponent } from "./models";
import { validateMaterialPayload } from "./validation";

export function createEmptyMaterialPayload(kind: MaterialKind, title: string): MaterialPayload {
  let component: PortableComponent;
  switch (kind) {
    case "imageGroup":
      component = { kind, name: title, description: "", images: [] };
      break;
    case "shootingLocation":
      component = { kind, venueName: title, address: "", description: "", gallery: { images: [] } };
      break;
    case "modelCard":
      component = { kind, modelId: title, heightCm: null, weightKg: null, shoeSize: "", notes: "", samples: { images: [] } };
      break;
    case "prop":
      component = { kind, title, source: "", gallery: { images: [] } };
      break;
    case "clothing":
      component = { kind, title, source: "", mainGallery: { images: [] } };
      break;
  }
  return validateMaterialPayload({ format: "preshot-material", version: 1, kind, component });
}
