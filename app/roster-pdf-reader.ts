import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import "pdfjs-dist/legacy/build/pdf.worker.min.mjs";
import { parseIvuPlanTextItems, type PositionedPdfText } from "./roster-pdf-domain";
import {
  parseRosterMonthHeader,
  type RosterProgress,
  type RosterScan,
} from "./roster-reader";

const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_PDF_PAGES = 12;

function validatePdf(file: File) {
  const isPdf = file.type.toLowerCase() === "application/pdf" || /\.pdf$/iu.test(file.name);
  if (!isPdf) throw new Error("Choose an IVU.plan PDF or a PNG, JPG, or WebP roster screenshot.");
  if (file.size > MAX_PDF_BYTES) throw new Error("That PDF is too large. Choose one smaller than 15 MB.");
}

export async function readRosterPdf(
  file: File,
  onProgress: (progress: RosterProgress) => void,
  isCancelled: () => boolean,
): Promise<RosterScan> {
  validatePdf(file);
  onProgress({ label: "Opening IVU.plan PDF", percent: 5 });
  const loadingTask = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    useWorkerFetch: false,
  });

  try {
    const document = await loadingTask.promise;
    if (document.numPages > MAX_PDF_PAGES) {
      throw new Error(`That PDF has ${document.numPages} pages. Choose the monthly IVU.plan duty schedule.`);
    }
    let recognizedError: Error | null = null;

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (isCancelled()) throw new DOMException("Roster import cancelled", "AbortError");
      onProgress({
        label: `Reading PDF page ${pageNumber} of ${document.numPages}`,
        percent: Math.round(10 + (pageNumber / document.numPages) * 75),
      });
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items.flatMap<PositionedPdfText>((item) => {
        if (!("str" in item) || !item.str.trim()) return [];
        return [{
          str: item.str,
          x: Number(item.transform[4]),
          y: Number(item.transform[5]),
          width: Number(item.width),
          height: Number(item.height),
        }];
      });
      const pageText = items.map((item) => item.str).join(" ");
      const detectedMonth = parseRosterMonthHeader(pageText);
      const isIvuSchedule = /duty\s+schedule\s+for\s*:/iu.test(pageText);
      if (!detectedMonth || !isIvuSchedule) {
        page.cleanup();
        continue;
      }
      try {
        const observations = parseIvuPlanTextItems(items, detectedMonth.year, detectedMonth.monthIndex);
        onProgress({ label: "Preparing review", percent: 100 });
        page.cleanup();
        return {
          ...detectedMonth,
          width: viewport.width,
          height: viewport.height,
          observations,
        };
      } catch (error) {
        recognizedError = error instanceof Error ? error : new Error("The IVU.plan PDF could not be read.");
        page.cleanup();
      }
    }

    if (recognizedError) throw recognizedError;
    throw new Error("No IVU.plan monthly duty schedule was found in this PDF.");
  } finally {
    await loadingTask.destroy();
  }
}
