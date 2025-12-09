import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

export interface ExtractedContent {
  title: string;
  content: string;
  excerpt?: string;
  byline?: string;
  siteName?: string;
}

/**
 * Extract clean content from HTML using Mozilla Readability
 */
export async function extractFromHtml(
  html: string,
  url?: string
): Promise<ExtractedContent | null> {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article) {
    return null;
  }

  return {
    title: article.title,
    content: article.textContent,
    excerpt: article.excerpt,
    byline: article.byline,
    siteName: article.siteName,
  };
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
