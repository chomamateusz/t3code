import {
  type PreviewAnnotationPayload,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@t3tools/contracts";

import { dataUrlToFile, prepareImageForAttachment } from "./imageCompression";

export type PreviewAnnotationCapture =
  | { readonly status: "captured"; readonly file: File }
  | { readonly status: "none" }
  | { readonly status: "failed" };

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

/** Decode Electron's PNG crop locally; fetching a data URL violates desktop connect-src. */
export async function capturePreviewAnnotationScreenshot(
  annotation: PreviewAnnotationPayload,
): Promise<PreviewAnnotationCapture> {
  if (!annotation.screenshot) return { status: "none" };
  try {
    const { dataUrl } = annotation.screenshot;
    if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
      return { status: "failed" };
    }
    const file = dataUrlToFile(dataUrl, `preview-annotation-${annotation.id}.png`, "image/png");
    if (file.size === 0) return { status: "failed" };
    const prepared = await prepareImageForAttachment(file, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES);
    return prepared.ok ? { status: "captured", file: prepared.file } : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}
