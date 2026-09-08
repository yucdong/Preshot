import { useEffect, useState } from "react";
import type { MaterialDetail, MaterialSearch, MaterialSearchResult, MaterialSummary } from "../../domain/library/models";
import type { MaterialLibraryRepository } from "../../domain/library/ports";
import { validateMaterialPayload } from "../../domain/library";
import { libraryError } from "./libraryUi";

export function useMaterialSearch(repository: MaterialLibraryRepository, input: MaterialSearch, refresh: number) {
  const key = JSON.stringify([input, refresh]);
  const [state, setState] = useState<{ key: string; result?: MaterialSearchResult; error?: string }>({ key: "" });
  useEffect(() => {
    if (repository.availability === "unavailable") return;
    let current = true;
    const [request] = JSON.parse(key) as [MaterialSearch, number];
    repository.search(request).then(
      (result) => { if (current) setState({ key, result }); },
      (error: unknown) => { if (current) setState({ key, error: libraryError(error, "无法读取素材库") }); },
    );
    return () => { current = false; };
  }, [repository, key]);
  return state.key === key ? state : { key };
}

interface DetailState {
  key: string;
  detail?: MaterialDetail;
  error?: string;
  checking: boolean;
  missing: number[];
}

export function useMaterialDetail(
  repository: MaterialLibraryRepository, selected: MaterialSummary | undefined, refresh: number,
) {
  const id = selected?.id;
  const key = `${id}:${selected?.revision}:${selected?.metadataVersion}:${refresh}`;
  const [state, setState] = useState<DetailState>({ key: "", checking: false, missing: [] });
  useEffect(() => {
    if (!id || repository.availability === "unavailable") return;
    let current = true;
    void (async () => {
      try {
        const detail = await repository.get(id);
        if (!current) return;
        validateMaterialPayload(detail.payload);
        setState({ key, detail, checking: detail.images.length > 0, missing: [] });
        const missing: number[] = [];
        let next = 0;
        // Bound native reads and discard image URLs immediately; only the selected preview retains pixels.
        const worker = async () => {
          while (current && next < detail.images.length) {
            const index = next++;
            try {
              const url = await repository.loadImage(detail.id, detail.revision, detail.images[index].localImageId);
              if (!url) missing.push(index + 1);
            } catch {
              missing.push(index + 1);
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(4, detail.images.length) }, worker));
        if (current) setState({ key, detail, checking: false, missing: missing.sort((a, b) => a - b) });
      } catch (error) {
        if (current) setState({ key, checking: false, missing: [], error: libraryError(error, "无法读取素材详情") });
      }
    })();
    return () => { current = false; };
  }, [repository, id, key]);
  return state.key === key ? state : { key, checking: Boolean(id), missing: [] } satisfies DetailState;
}
