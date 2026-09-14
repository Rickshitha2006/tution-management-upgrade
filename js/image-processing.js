/* ==========================================================================
   Tuition Manager — image-processing.js
   ==========================================================================
   Client-side (Canvas API) image handling for the two new upload types:

   1. Tuition logo — resized/compressed so it never bloats the settings
      row, aspect ratio preserved, transparency preserved if the source
      has it.
   2. Head/staff signatures — the above, PLUS best-effort background
      removal: a simple, well-understood technique (not ML/server-side)
      that samples the image's corner pixels as the "background color"
      and makes near-matching pixels transparent, then auto-crops to the
      remaining ink. This only ever removes pixels close to the sampled
      background — a real signature's ink is never invented or altered.

   Nothing here reads outside the file the user selected; everything runs
   in the browser before the (already-small) result is ever uploaded.
   ========================================================================== */

const TM_IMAGE_MAX_RAW_BYTES = 15 * 1024 * 1024; // 15MB — generous, matches "phone photo" use case
const TM_LOGO_MAX_DIMENSION = 480;
const TM_SIGNATURE_MAX_DIMENSION = 640;

/**
 * Validates a file picked for logo/signature upload.
 * Returns { ok: true } or { ok: false, message }.
 * PDFs are explicitly rejected here with a friendly fallback message —
 * rendering a PDF logo/signature client-side would need a large extra
 * library (pdf.js), which this project deliberately avoids pulling in
 * for a single-page-extraction use case (see item 51/52 of the brief).
 */
function tmValidateImageFile(file) {
  if (!file) return { ok: false, message: "Please choose a file." };
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name || "")) {
    return {
      ok: false,
      message: "PDF files aren't supported here yet — please export/save that page as a PNG or JPG image and upload that instead.",
    };
  }
  const okTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
  if (!okTypes.includes(file.type)) {
    return { ok: false, message: "Please upload a PNG, JPG or WebP image." };
  }
  if (file.size > TM_IMAGE_MAX_RAW_BYTES) {
    return { ok: false, message: "That image is too large (max 15MB). Please choose a smaller file." };
  }
  return { ok: true };
}

function tmLoadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file doesn't look like a valid image."));
    };
    img.src = url;
  });
}

function tmFitDimensions(width, height, maxDimension) {
  if (width <= maxDimension && height <= maxDimension) return { width, height };
  const scale = width >= height ? maxDimension / width : maxDimension / height;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Logo: resize (never upscale) to fit within TM_LOGO_MAX_DIMENSION on
 * its longest side, preserving aspect ratio and transparency, and
 * re-encode as PNG (keeps transparency; logos are usually small/simple
 * enough that PNG stays compact after downscaling).
 */
async function tmProcessLogoFile(file) {
  const check = tmValidateImageFile(file);
  if (!check.ok) throw new Error(check.message);

  const img = await tmLoadImageFromFile(file);
  const { width, height } = tmFitDimensions(img.naturalWidth, img.naturalHeight, TM_LOGO_MAX_DIMENSION);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  return canvas.toDataURL("image/png");
}

/**
 * Signature: resize, then remove a near-uniform background (typically
 * white paper or a grey scan) by sampling the four corners of the image
 * as reference background color(s) and making close-matching pixels
 * transparent — with a soft-edged tolerance band so anti-aliased edges
 * of the pen strokes don't get a hard cutout. Finally auto-crops to the
 * bounding box of the remaining (non-transparent) ink, with a small
 * margin, so the signature sits close-cropped in the report.
 *
 * This never invents or redraws strokes — it only ever *removes* pixels
 * that closely match the sampled background color. If the source image
 * already has transparency (e.g. a PNG signature exported from a
 * drawing app), corner pixels sampled as transparent are treated as
 * "background alpha 0" and nothing is changed.
 */
async function tmProcessSignatureFile(file) {
  const check = tmValidateImageFile(file);
  if (!check.ok) throw new Error(check.message);

  const img = await tmLoadImageFromFile(file);
  const { width, height } = tmFitDimensions(img.naturalWidth, img.naturalHeight, TM_SIGNATURE_MAX_DIMENSION);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const bg = tmSampleBackgroundColor(imageData);
  tmMakeBackgroundTransparent(imageData, bg);
  ctx.putImageData(imageData, 0, 0);

  const cropped = tmAutoCropToContent(canvas);
  return cropped.toDataURL("image/png");
}

/**
 * Averages the pixel color at each of the four corners (a small patch,
 * not just one pixel, to be robust to scan noise/JPEG artifacts) to get
 * a single reference "background" RGB + whether it's already transparent.
 */
function tmSampleBackgroundColor(imageData) {
  const { data, width, height } = imageData;
  const patch = Math.max(2, Math.round(Math.min(width, height) * 0.03));
  const corners = [
    [0, 0],
    [width - patch, 0],
    [0, height - patch],
    [width - patch, height - patch],
  ];

  let r = 0, g = 0, b = 0, a = 0, count = 0;
  corners.forEach(([cx, cy]) => {
    for (let y = cy; y < cy + patch; y++) {
      for (let x = cx; x < cx + patch; x++) {
        const i = (y * width + x) * 4;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        a += data[i + 3];
        count++;
      }
    }
  });

  return { r: r / count, g: g / count, b: b / count, a: a / count };
}

/**
 * Sets alpha to 0 for pixels close to the sampled background color, with
 * a soft-edged band between "definitely background" and "definitely ink"
 * so strokes keep clean anti-aliased edges instead of a jagged cutout.
 */
function tmMakeBackgroundTransparent(imageData, bg) {
  const { data } = imageData;
  const HARD_THRESHOLD = 28; // distance below this: fully transparent
  const SOFT_THRESHOLD = 70; // distance above this: fully opaque (untouched)

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];

    // Already-transparent source pixels stay transparent.
    if (bg.a < 10 && a < 10) continue;

    const dist = Math.sqrt((r - bg.r) ** 2 + (g - bg.g) ** 2 + (b - bg.b) ** 2);

    if (dist <= HARD_THRESHOLD) {
      data[i + 3] = 0;
    } else if (dist < SOFT_THRESHOLD) {
      const t = (dist - HARD_THRESHOLD) / (SOFT_THRESHOLD - HARD_THRESHOLD);
      data[i + 3] = Math.round(a * t);
    }
    // dist >= SOFT_THRESHOLD: leave fully opaque — this is ink.
  }
}

/**
 * Crops a canvas to the bounding box of its non-transparent pixels
 * (with a small padding margin), so the signature isn't sitting in a
 * large empty transparent rectangle. Falls back to the original canvas
 * if nothing is opaque enough to detect (e.g. an all-background image),
 * so we never return a 0×0 canvas.
 */
function tmAutoCropToContent(canvas) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;

  let minX = width, minY = height, maxX = -1, maxY = -1;
  const ALPHA_THRESHOLD = 20;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3];
      if (a > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return canvas; // nothing detected — return as-is

  const pad = Math.round(Math.max(width, height) * 0.03);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);

  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;

  const out = document.createElement("canvas");
  out.width = cropWidth;
  out.height = cropHeight;
  out.getContext("2d").drawImage(canvas, minX, minY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return out;
}
