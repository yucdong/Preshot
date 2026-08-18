import type {
  PreshotDocxImageGroupCompositeRequest,
  PreshotDocxImageGroupCompositor,
} from "./imageGroupDocxMapping";

interface PointRect {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  rect: PointRect,
): void {
  const radius = Math.max(
    0,
    Math.min(rect.radius, rect.width / 2, rect.height / 2),
  );
  context.beginPath();
  context.moveTo(rect.x + radius, rect.y);
  context.lineTo(rect.x + rect.width - radius, rect.y);
  context.quadraticCurveTo(
    rect.x + rect.width,
    rect.y,
    rect.x + rect.width,
    rect.y + radius,
  );
  context.lineTo(rect.x + rect.width, rect.y + rect.height - radius);
  context.quadraticCurveTo(
    rect.x + rect.width,
    rect.y + rect.height,
    rect.x + rect.width - radius,
    rect.y + rect.height,
  );
  context.lineTo(rect.x + radius, rect.y + rect.height);
  context.quadraticCurveTo(
    rect.x,
    rect.y + rect.height,
    rect.x,
    rect.y + rect.height - radius,
  );
  context.lineTo(rect.x, rect.y + radius);
  context.quadraticCurveTo(
    rect.x,
    rect.y,
    rect.x + radius,
    rect.y,
  );
  context.closePath();
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Unable to encode the DOCX image-group composite."));
        return;
      }
      blob.arrayBuffer()
        .then((buffer) => resolve(new Uint8Array(buffer)))
        .catch(reject);
    }, "image/png");
  });
}

function pixelRect(
  request: PreshotDocxImageGroupCompositeRequest,
  rect: {
    xPoints: number;
    yPoints: number;
    widthPoints: number;
    heightPoints: number;
    borderRadiusPoints: number;
  },
): PointRect {
  const scaleX =
    request.raster.width / request.display.widthPoints;
  const scaleY =
    request.raster.height / request.display.heightPoints;
  return {
    x: rect.xPoints * scaleX,
    y: rect.yPoints * scaleY,
    width: rect.widthPoints * scaleX,
    height: rect.heightPoints * scaleY,
    radius: rect.borderRadiusPoints * Math.min(scaleX, scaleY),
  };
}

async function decodeAsset(
  mime: string,
  bytes: Readonly<Uint8Array>,
): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([Uint8Array.from(bytes)], { type: mime }));
}

export const composePreshotDocxImageGroupInBrowser:
  PreshotDocxImageGroupCompositor = async (request) => {
    const canvas = document.createElement("canvas");
    canvas.width = request.raster.width;
    canvas.height = request.raster.height;
    const context = canvas.getContext("2d", {
      alpha: false,
      colorSpace: "srgb",
    });
    if (!context) {
      throw new Error("Unable to create the DOCX image-group canvas.");
    }

    context.fillStyle = request.backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    const surface = pixelRect(request, {
      xPoints: request.surface.xPoints,
      yPoints: request.surface.yPoints,
      widthPoints: request.surface.widthPoints,
      heightPoints: request.surface.heightPoints,
      borderRadiusPoints: request.surface.borderRadiusPoints,
    });
    roundedRectPath(context, surface);
    context.fillStyle = request.surface.backgroundColor;
    context.fill();
    context.save();
    roundedRectPath(context, surface);
    context.clip();

    for (const image of request.images) {
      const frame = pixelRect(request, {
        xPoints: image.xPoints,
        yPoints: image.yPoints,
        widthPoints: image.widthPoints,
        heightPoints: image.heightPoints,
        borderRadiusPoints: image.borderRadiusPoints,
      });
      roundedRectPath(context, frame);
      context.fillStyle = image.backgroundColor;
      context.fill();
      context.save();
      roundedRectPath(context, frame);
      context.clip();
      const bitmap = await decodeAsset(image.asset.mime, image.asset.bytes);
      try {
        context.drawImage(
          bitmap,
          frame.x,
          frame.y,
          frame.width,
          frame.height,
        );
      } finally {
        bitmap.close();
      }
      context.restore();
      roundedRectPath(context, frame);
      context.strokeStyle = image.borderColor;
      context.lineWidth = Math.max(
        1,
        image.borderWidthPoints *
          Math.min(
            request.raster.width / request.display.widthPoints,
            request.raster.height / request.display.heightPoints,
          ),
      );
      context.stroke();
    }
    context.restore();
    roundedRectPath(context, surface);
    context.strokeStyle = request.surface.borderColor;
    context.lineWidth = Math.max(
      1,
      request.surface.borderWidthPoints *
        Math.min(
          request.raster.width / request.display.widthPoints,
          request.raster.height / request.display.heightPoints,
        ),
    );
    context.stroke();

    return canvasPng(canvas);
  };
