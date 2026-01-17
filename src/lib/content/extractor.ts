import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

export interface ExtractedContent {
  title: string;
  content: string;
  excerpt?: string;
  byline?: string;
  siteName?: string;
  leadImageUrl?: string;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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
    title: article.title,
    content: article.textContent,
    excerpt: article.excerpt,
    byline: article.byline,
    siteName: article.siteName,
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
