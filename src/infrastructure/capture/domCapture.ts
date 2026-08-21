export const DOM_CAPTURE_PIXEL_RATIO = 1 as const;
export const DOM_CAPTURE_MAX_DIMENSION = 16_384;
export const DOM_CAPTURE_MAX_PIXELS = 16_777_216;

export type DomCaptureFormat = "image/png" | "image/jpeg";

export interface DomCaptureViewport {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}

interface DomCaptureRequestBase {
  format: DomCaptureFormat;
  quality?: number;
  viewport?: DomCaptureViewport;
}

export interface DomCaptureCanvasRequest extends DomCaptureRequestBase {
  output: "canvas";
}

export interface DomCaptureBlobRequest extends DomCaptureRequestBase {
  output: "blob";
}

export type DomCaptureRequest =
  | DomCaptureCanvasRequest
  | DomCaptureBlobRequest;

interface DomCaptureResultBase {
  width: number;
  height: number;
  pixelRatio: typeof DOM_CAPTURE_PIXEL_RATIO;
}

export interface DomCaptureCanvasResult extends DomCaptureResultBase {
  output: "canvas";
  canvas: HTMLCanvasElement;
}

export interface DomCaptureBlobResult extends DomCaptureResultBase {
  output: "blob";
  blob: Blob;
}

export type DomCaptureResult =
  | DomCaptureCanvasResult
  | DomCaptureBlobResult;

export interface DomCaptureSession {
  capture(request: DomCaptureRequest): Promise<DomCaptureResult>;
  close(): void;
}

export interface DomCaptureAdapter {
  createSession(element: HTMLElement): Promise<DomCaptureSession>;
  capture(
    element: HTMLElement,
    request: DomCaptureRequest,
  ): Promise<DomCaptureResult>;
}
