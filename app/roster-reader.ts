export type RosterBarKind = "blue" | "green" | "none";

export type RosterObservation = {
  day: number;
  rawCode: string;
  rawText: string;
  times: string[];
  barKind: RosterBarKind;
  confidence: number;
};

export type RosterScan = {
  year: number;
  monthIndex: number;
  width: number;
  height: number;
  observations: RosterObservation[];
};

export type RosterProgress = {
  label: string;
  percent: number;
};

const MONTHS = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
];

const MAX_IMAGE_EDGE = 2200;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

export function parseRosterMonthHeader(text: string) {
  const normalized = text
    .toUpperCase()
    .replace(/[|!]/g, "I")
    .replace(/[^A-Z0-9\s]/g, " ");
  const yearMatch = normalized.match(/\b(?:19|20)\d{2}\b/);
  if (!yearMatch) return null;

  const words = normalized.match(/[A-Z]{3,9}/g) ?? [];
  let monthIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const word of words) {
    const monthWord = word === "JUI" ? "JUL" : word;
    for (let index = 0; index < MONTHS.length; index += 1) {
      const candidate = MONTHS[index];
      const distance = Math.min(
        editDistance(monthWord.slice(0, 3), candidate.slice(0, 3)),
        editDistance(monthWord, candidate),
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        monthIndex = index;
      }
    }
  }
  if (monthIndex < 0 || bestDistance > 1) return null;
  return { year: Number(yearMatch[0]), monthIndex };
}

function extractTimes(text: string) {
  const normalized = text
    .toUpperCase()
    .replace(/[OQ]/g, "0")
    .replace(/[IL|]/g, "1")
    .replace(/[S]/g, "5");
  const candidates = normalized.match(/\b\d{1,2}:?\d{2}\+?\b/g) ?? [];
  const times: string[] = [];
  for (const candidate of candidates) {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length < 3 || digits.length > 4) continue;
    const hours = Number(digits.slice(0, -2));
    const minutes = Number(digits.slice(-2));
    if (hours > 23 || minutes > 59) continue;
    const time = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    if (!times.includes(time)) times.push(time);
  }
  return times.slice(0, 2);
}

async function loadImage(file: File) {
  const hasSupportedExtension = /\.(?:jpe?g|png|webp)$/iu.test(file.name);
  if (!SUPPORTED_IMAGE_TYPES.has(file.type.toLowerCase()) && !hasSupportedExtension) {
    throw new Error("Choose a PNG, JPG, or WebP roster screenshot.");
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("That image is too large. Choose one smaller than 15 MB.");
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    if (image.naturalWidth < 600 || image.naturalHeight < 240) {
      throw new Error("That screenshot is too small to read clearly.");
    }
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("This browser could not open the screenshot.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { canvas, context };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function pixelKind(red: number, green: number, blue: number): RosterBarKind {
  if (blue > 120 && blue - red > 45 && blue - green > 20) return "blue";
  if (green > 125 && green - red > 28 && green - blue > 28) return "green";
  return "none";
}

type Band = { top: number; bottom: number; score: number };

function findRosterBands(data: ImageData, expectedRows: number): Band[] {
  const { width, height } = data;
  const counts = new Uint32Array(height);
  for (let y = 0; y < height; y += 1) {
    let count = 0;
    for (let x = 0; x < width; x += 2) {
      const offset = (y * width + x) * 4;
      if (pixelKind(data.data[offset], data.data[offset + 1], data.data[offset + 2]) !== "none") {
        count += 1;
      }
    }
    counts[y] = count;
  }

  const threshold = Math.max(18, Math.round(width * 0.018));
  const bands: Band[] = [];
  let start = -1;
  let score = 0;
  for (let y = 0; y <= height; y += 1) {
    const active = y < height && counts[y] >= threshold;
    if (active && start < 0) {
      start = y;
      score = counts[y];
    } else if (active) {
      score = Math.max(score, counts[y]);
    } else if (start >= 0) {
      const band = { top: start, bottom: y - 1, score };
      if (band.bottom - band.top >= 5 && band.bottom - band.top <= height * 0.12) bands.push(band);
      start = -1;
      score = 0;
    }
  }

  if (bands.length === expectedRows) return bands;
  if (bands.length > expectedRows) {
    return [...bands]
      .sort((left, right) => right.score - left.score)
      .slice(0, expectedRows)
      .sort((left, right) => left.top - right.top);
  }

  const gridTop = Math.round(height * 0.066);
  const gridBottom = Math.round(height * 0.975);
  const rowHeight = (gridBottom - gridTop) / expectedRows;
  return Array.from({ length: expectedRows }, (_, index) => ({
    top: Math.round(gridTop + index * rowHeight + rowHeight * 0.22),
    bottom: Math.round(gridTop + index * rowHeight + rowHeight * 0.5),
    score: 0,
  }));
}

function findGridBounds(data: ImageData, bands: Band[]) {
  const strongestBand = [...bands].sort((left, right) => right.score - left.score)[0];
  if (!strongestBand) return { left: data.width * 0.004, right: data.width * 0.994 };
  const counts = new Uint16Array(data.width);
  for (let x = 0; x < data.width; x += 1) {
    for (let y = strongestBand.top; y <= strongestBand.bottom; y += 1) {
      const offset = (y * data.width + x) * 4;
      if (pixelKind(data.data[offset], data.data[offset + 1], data.data[offset + 2]) !== "none") {
        counts[x] += 1;
      }
    }
  }

  const minimumHeight = Math.max(3, (strongestBand.bottom - strongestBand.top + 1) * 0.42);
  const runs: Array<{ start: number; end: number }> = [];
  let start = -1;
  for (let x = 0; x <= data.width; x += 1) {
    const active = x < data.width && counts[x] >= minimumHeight;
    if (active && start < 0) start = x;
    if (!active && start >= 0) {
      if (x - start > data.width / 20) runs.push({ start, end: x - 1 });
      start = -1;
    }
  }
  if (runs.length !== 7) return { left: data.width * 0.004, right: data.width * 0.994 };

  const gaps = runs.slice(1).map((run, index) => run.start - runs[index].start).sort((left, right) => left - right);
  const widths = runs.map((run) => run.end - run.start + 1).sort((left, right) => left - right);
  const cellWidth = gaps[Math.floor(gaps.length / 2)];
  const barWidth = widths[Math.floor(widths.length / 2)];
  const sideMargin = Math.max(0, (cellWidth - barWidth) / 2);
  const left = Math.max(0, Math.round(runs[0].start - sideMargin));
  return { left, right: Math.min(data.width, left + cellWidth * 7) };
}

function makeBinaryCrop(
  source: CanvasRenderingContext2D,
  rectangle: { x: number; y: number; width: number; height: number },
  keepPixel: (red: number, green: number, blue: number) => boolean,
) {
  const x = Math.max(0, Math.round(rectangle.x));
  const y = Math.max(0, Math.round(rectangle.y));
  const width = Math.max(1, Math.round(rectangle.width));
  const height = Math.max(1, Math.round(rectangle.height));
  const pixels = source.getImageData(x, y, width, height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const keep = keepPixel(pixels.data[index], pixels.data[index + 1], pixels.data[index + 2]);
    const value = keep ? 0 : 255;
    pixels.data[index] = value;
    pixels.data[index + 1] = value;
    pixels.data[index + 2] = value;
    pixels.data[index + 3] = 255;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.putImageData(pixels, 0, 0);
  return canvas;
}

function sharpenCanvas(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const source = new Uint8ClampedArray(pixels.data);
  const kernel = [-2, -2, -2, -2, 32, -2, -2, -2, -2];
  for (let y = 1; y < canvas.height - 1; y += 1) {
    for (let x = 1; x < canvas.width - 1; x += 1) {
      const target = (y * canvas.width + x) * 4;
      let total = 0;
      for (let row = -1; row <= 1; row += 1) {
        for (let column = -1; column <= 1; column += 1) {
          const sourceOffset = ((y + row) * canvas.width + x + column) * 4;
          total += source[sourceOffset] * kernel[(row + 1) * 3 + column + 1];
        }
      }
      const value = Math.max(0, Math.min(255, total / 16));
      pixels.data[target] = value;
      pixels.data[target + 1] = value;
      pixels.data[target + 2] = value;
    }
  }
  context.putImageData(pixels, 0, 0);
}

function makeCellOcrImage(
  context: CanvasRenderingContext2D,
  cell: { x: number; width: number; height: number },
  band: Band,
) {
  const scale = 4;
  const code = makeBinaryCrop(
    context,
    {
      x: cell.x + cell.width * 0.1,
      y: band.top,
      width: cell.width * 0.48,
      height: band.bottom - band.top + 1,
    },
    (red, green, blue) => (red * 299 + green * 587 + blue * 114) / 1000 > 175,
  );
  const times = makeBinaryCrop(
    context,
    {
      x: cell.x + cell.width * 0.025,
      y: band.bottom + cell.height * 0.025,
      width: cell.width * 0.2,
      height: cell.height * 0.42,
    },
    (red, green, blue) => (red * 299 + green * 587 + blue * 114) / 1000 < 145,
  );

  const output = document.createElement("canvas");
  output.width = Math.max(code.width, times.width) * scale + 48;
  output.height = (code.height + times.height) * scale + 64;
  const outputContext = output.getContext("2d");
  if (!outputContext) throw new Error("This browser could not prepare the screenshot.");
  outputContext.fillStyle = "#fff";
  outputContext.fillRect(0, 0, output.width, output.height);
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = "high";
  outputContext.drawImage(code, 24, 16, code.width * scale, code.height * scale);
  outputContext.drawImage(times, 24, code.height * scale + 40, times.width * scale, times.height * scale);
  sharpenCanvas(output, outputContext);
  return output;
}

function classifyCellBar(
  data: ImageData,
  cellX: number,
  cellWidth: number,
  band: Band,
) {
  let blue = 0;
  let green = 0;
  const startX = Math.max(0, Math.round(cellX + cellWidth * 0.02));
  const endX = Math.min(data.width, Math.round(cellX + cellWidth * 0.98));
  for (let y = Math.max(0, band.top); y <= Math.min(data.height - 1, band.bottom); y += 2) {
    for (let x = startX; x < endX; x += 3) {
      const offset = (y * data.width + x) * 4;
      const kind = pixelKind(data.data[offset], data.data[offset + 1], data.data[offset + 2]);
      if (kind === "blue") blue += 1;
      if (kind === "green") green += 1;
    }
  }
  const threshold = Math.max(10, cellWidth * 0.15);
  if (green > blue && green > threshold) return "green" as const;
  if (blue > threshold) return "blue" as const;
  return "none" as const;
}

export async function readRosterImage(
  file: File,
  onProgress: (progress: RosterProgress) => void,
  isCancelled: () => boolean = () => false,
): Promise<RosterScan> {
  onProgress({ label: "Opening screenshot", percent: 2 });
  const { canvas, context } = await loadImage(file);
  const { createWorker, OEM, PSM } = await import("tesseract.js");
  let setupPercent = 3;
  let setupComplete = false;
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/core",
    langPath: "/ocr/lang",
    gzip: true,
    workerBlobURL: false,
    logger: ({ status, progress }) => {
      if (setupComplete) return;
      const nextPercent = Math.max(setupPercent, Math.min(20, Math.round(3 + progress * 17)));
      setupPercent = nextPercent;
      onProgress({ label: status.replace(/^./, (letter) => letter.toUpperCase()), percent: nextPercent });
    },
  });
  setupComplete = true;

  try {
    if (isCancelled()) throw new DOMException("Roster import cancelled", "AbortError");
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ",
    });
    onProgress({ label: "Reading month and year", percent: 22 });
    const headerWidth = Math.min(canvas.width, Math.round(canvas.width * 0.3));
    const headerHeight = Math.min(canvas.height, Math.max(24, Math.round(canvas.height * 0.065)));
    const headerCrop = makeBinaryCrop(
      context,
      { x: 0, y: 0, width: headerWidth, height: headerHeight },
      (red, green, blue) => (red * 299 + green * 587 + blue * 114) / 1000 < 180,
    );
    const header = document.createElement("canvas");
    header.width = headerCrop.width * 4 + 48;
    header.height = headerCrop.height * 4 + 32;
    const headerContext = header.getContext("2d");
    if (!headerContext) throw new Error("This browser could not prepare the screenshot.");
    headerContext.fillStyle = "#fff";
    headerContext.fillRect(0, 0, header.width, header.height);
    headerContext.imageSmoothingEnabled = true;
    headerContext.imageSmoothingQuality = "high";
    headerContext.drawImage(headerCrop, 24, 16, headerCrop.width * 4, headerCrop.height * 4);
    sharpenCanvas(header, headerContext);
    const headerResult = await worker.recognize(header);
    if (isCancelled()) throw new DOMException("Roster import cancelled", "AbortError");
    const detectedMonth = parseRosterMonthHeader(headerResult.data.text);
    if (!detectedMonth) {
      throw new Error("The month and year could not be read. Upload the full roster screenshot with its title visible.");
    }

    const daysInMonth = new Date(detectedMonth.year, detectedMonth.monthIndex + 1, 0).getDate();
    const leadingMondayCells = (new Date(Date.UTC(detectedMonth.year, detectedMonth.monthIndex, 1)).getUTCDay() + 6) % 7;
    const rowCount = Math.ceil((leadingMondayCells + daysInMonth) / 7);
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const bands = findRosterBands(imageData, rowCount);
    const { left: gridLeft, right: gridRight } = findGridBounds(imageData, bands);
    const cellWidth = (gridRight - gridLeft) / 7;
    const rowHeight = bands.length > 1
      ? bands.slice(1).reduce((total, band, index) => total + band.top - bands[index].top, 0) / (bands.length - 1)
      : canvas.height * 0.18;

    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:-+ ",
      preserve_interword_spaces: "1",
    });

    const observations: RosterObservation[] = [];
    for (let day = 1; day <= daysInMonth; day += 1) {
      if (isCancelled()) throw new DOMException("Roster import cancelled", "AbortError");
      const cellIndex = leadingMondayCells + day - 1;
      const row = Math.floor(cellIndex / 7);
      const column = cellIndex % 7;
      const band = bands[row];
      const cellX = gridLeft + column * cellWidth;
      const barKind = classifyCellBar(imageData, cellX, cellWidth, band);
      let rawText = "";
      let rawCode = "";
      let times: string[] = [];
      let confidence = barKind === "green" ? 100 : 0;

      if (barKind === "blue") {
        const ocrImage = makeCellOcrImage(context, { x: cellX, width: cellWidth, height: rowHeight }, band);
        const result = await worker.recognize(ocrImage);
        if (isCancelled()) throw new DOMException("Roster import cancelled", "AbortError");
        rawText = result.data.text.trim();
        rawCode = (rawText.split(/\r?\n/).find((line) => /[A-Z]/i.test(line)) ?? "").trim();
        times = extractTimes(rawText);
        confidence = Math.round(result.data.confidence);
      } else if (barKind === "green") {
        rawText = "WR";
        rawCode = "WR";
      }

      observations.push({ day, rawCode, rawText, times, barKind, confidence });
      onProgress({
        label: `Reading day ${day} of ${daysInMonth}`,
        percent: Math.round(28 + (day / daysInMonth) * 70),
      });
    }

    onProgress({ label: "Preparing review", percent: 100 });
    return { ...detectedMonth, width: canvas.width, height: canvas.height, observations };
  } finally {
    await worker.terminate();
  }
}
