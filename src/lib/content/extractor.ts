import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";

export interface ExtractedContent {
  title: string;
  content: string;
  excerpt?: string;
  byline?: string;
  siteName?: string;
  leadImageUrl?: string;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const require = createRequire(import.meta.url);
const PDF_WORKER_SRC = pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs")).href;
let pdfWorkerReady: Promise<void> | null = null;

/**
 * Extract clean content from HTML using Mozilla Readability
 */
export async function extractFromHtml(
  html: string,
  url?: string
): Promise<ExtractedContent | null> {
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;
  const reader = new Readability(document);
  const article = reader.parse();

  if (!article) {
    return null;
  }

  const leadImageUrl = resolveImageUrl(
    (article as { lead_image_url?: string }).lead_image_url,
    url
  ) ?? resolveImageUrl(findMetaImage(document), url);

  return {
    title: article.title ?? document.title ?? "Untitled",
    content: article.textContent ?? "",
    excerpt: article.excerpt ?? undefined,
    byline: article.byline ?? undefined,
    siteName: article.siteName ?? undefined,
    leadImageUrl,
  };
}

function findMetaImage(document: Document): string | null {
  const selectors = [
    "meta[property='og:image']",
    "meta[property='og:image:secure_url']",
    "meta[property='og:image:url']",
    "meta[name='twitter:image']",
    "meta[name='twitter:image:src']",
    "link[rel='image_src']",
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (!element) continue;
    const value = element.getAttribute("content") || element.getAttribute("href");
    if (value) return value;
  }

  return null;
}

function resolveImageUrl(value: string | null | undefined, baseUrl?: string): string | undefined {
  if (!value) return undefined;
  if (!baseUrl) return value;

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

export type ImageDownloadResult = {
  url: string;
  publicPath: string;
  contentType: string;
};

export async function downloadDocumentImage(
  url: string,
  documentId: string,
  options?: {
    publicDir?: string;
    maxBytes?: number;
  }
): Promise<ImageDownloadResult | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; open-recall/1.0; +https://github.com/open-recall)",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      return null;
    }

    const maxBytes = options?.maxBytes ?? MAX_IMAGE_BYTES;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      return null;
    }

    const urlExtension = extname(new URL(url).pathname);
    const extension = urlExtension || `.${contentType.split("/")[1] || "jpg"}`;
    const fileName = `${documentId}${extension}`;
    const publicDir = options?.publicDir ?? join(process.cwd(), "public", "document-images");

    await mkdir(publicDir, { recursive: true });

    const filePath = join(publicDir, fileName);
    await writeFile(filePath, buffer);

    return {
      url,
      publicPath: `/document-images/${fileName}`,
      contentType,
    };
  } catch (error) {
    console.error("Failed to download document image:", error);
    return null;
  }
}

/**
 * Fetch and extract content from a URL
 */
export async function extractFromUrl(
  url: string
): Promise<ExtractedContent | null> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; open-recall/1.0; +https://github.com/open-recall)",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status}`);
  }

  const html = await response.text();
  return extractFromHtml(html, url);
}

export async function extractPdfFromUrl(url: string): Promise<ExtractedContent> {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; open-recall/1.0; +https://github.com/open-recall)",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch PDF: ${response.status}`);
  }

  const content = await extractPdfText(Buffer.from(await response.arrayBuffer()));
  return {
    title: titleFromUrl(url),
    content,
  };
}

export async function extractPdfText(data: Buffer | Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  await ensurePdfWorker(pdfjs);
  const bytes = data instanceof Buffer ? new Uint8Array(data) : data;
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    disableFontFace: true,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (text) pages.push(text);
  }

  const content = pages.join("\n\n").trim();
  if (!content) throw new Error("PDF did not contain extractable text");
  return content;
}

async function ensurePdfWorker(pdfjs: typeof import("pdfjs-dist/legacy/build/pdf.mjs")): Promise<void> {
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;

  const pdfjsGlobal = globalThis as typeof globalThis & {
    pdfjsWorker?: { WorkerMessageHandler: unknown };
  };

  if (pdfjsGlobal.pdfjsWorker?.WorkerMessageHandler) return;

  pdfWorkerReady ??= import("pdfjs-dist/legacy/build/pdf.worker.mjs").then((worker) => {
    pdfjsGlobal.pdfjsWorker = {
      WorkerMessageHandler: worker.WorkerMessageHandler,
    };
  });

  await pdfWorkerReady;
}

function titleFromUrl(url: string): string {
  const pathname = new URL(url).pathname;
  const fileName = decodeURIComponent(pathname.split("/").filter(Boolean).pop() ?? "");
  return fileName || "Untitled PDF";
}

/**
 * Detect content type from URL
 */
export function detectContentType(
  url: string
): "youtube" | "article" | "pdf" | "unknown" {
  const urlObj = new URL(url);

  // YouTube
  if (
    urlObj.hostname.includes("youtube.com") ||
    urlObj.hostname.includes("youtu.be")
  ) {
    return "youtube";
  }

  // PDF
  if (urlObj.pathname.endsWith(".pdf")) {
    return "pdf";
  }

  // Default to article
  return "article";
}

/**
 * Extract YouTube video ID from URL
 */
export function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/shorts\/([^&\n?#]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}
