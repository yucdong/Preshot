import boldUrl from "./fonts/NotoSansSC-Bold.otf?url";
import regularUrl from "./fonts/NotoSansSC-Regular.otf?url";

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  return new Uint8Array(await response.arrayBuffer());
}

export async function loadNotoSansSc(): Promise<{
  regular: Uint8Array;
  bold: Uint8Array;
}> {
  const [regular, bold] = await Promise.all([
    fetchBytes(regularUrl),
    fetchBytes(boldUrl),
  ]);

  return { regular, bold };
}
