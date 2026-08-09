import { expect, test } from "@playwright/test";

test("downsamples PDF images to their draw size and encodes JPEG", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 2400;
    canvas.height = 1600;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#135");
    gradient.addColorStop(0.5, "#d96");
    gradient.addColorStop(1, "#efd");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < 400; index += 1) {
      context.fillStyle = `hsl(${index % 360} 70% 55% / 0.7)`;
      context.fillRect(
        (index * 137) % canvas.width,
        (index * 83) % canvas.height,
        24 + (index % 60),
        18 + (index % 40),
      );
    }
    const source = canvas.toDataURL("image/png");
    const sourceBytes = Math.floor((source.length - source.indexOf(",") - 1) * 0.75);
    const optimizerModulePath = "/src/infrastructure/pdf/pdfImageOptimizer.ts";
    const { optimizePdfImage } = await import(/* @vite-ignore */ optimizerModulePath) as {
      optimizePdfImage(
        dataUrl: string,
        drawBox: { width: number; height: number },
      ): Promise<{ mime: string; bytes: Uint8Array }>;
    };
    const optimized = await optimizePdfImage(source, { width: 100, height: 75 });
    const bitmap = await createImageBitmap(
      new Blob([optimized.bytes], { type: optimized.mime }),
    );
    return {
      sourceBytes,
      optimizedBytes: optimized.bytes.length,
      mime: optimized.mime,
      width: bitmap.width,
      height: bitmap.height,
    };
  });

  expect(result).toMatchObject({
    mime: "image/jpeg",
    width: 200,
    height: 133,
  });
  expect(result.optimizedBytes).toBeLessThan(result.sourceBytes * 0.2);
});