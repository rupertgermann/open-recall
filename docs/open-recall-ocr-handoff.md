# Handoff: Missing OCR Support for Image-Only PDFs

## Context

Repository: `D:\Git_Projects\open-recall`

The previous session investigated a Drive folder import failure:

`File 1/461: [redacted scanned medical PDF filename] failed: PDF did not contain extractable text`

Root cause: `src/lib/content/extractor.ts` uses `pdfjs-dist` in `extractPdfText`. For scanned/image-only PDFs, pdf.js returns no text items, and the old implementation threw `PDF did not contain extractable text`. That made Drive folder import report the file as failed.

A narrow mitigation has already been implemented in the working tree: image-only PDFs now return a placeholder string instead of throwing. This keeps Drive folder import moving, but it is not real OCR.

## Current Local Diff

Do not duplicate the diff here. Inspect the local changes directly:

- `src/lib/content/extractor.ts`
- `tests/drive.test.ts`
- command: `git diff -- src/lib/content/extractor.ts tests/drive.test.ts`

Current behavior added by the diff:

- `extractPdfText` preserves normal extracted PDF text.
- If no text is found, it returns: `This PDF did not contain extractable text. It may be a scanned or image-only document.`
- `tests/drive.test.ts` includes a regression test for a valid one-page PDF with no text stream.

Verification already run:

- `node --test --experimental-strip-types tests/drive.test.ts` passed.
- `npm test` passed, 73/73.
- `npm run lint` completed with warnings only, no errors. The warnings were pre-existing and unrelated.

## Next Session Goal

Implement real OCR support for scanned/image-only PDFs so medical/scan PDFs become searchable Documents instead of placeholder-only Documents.

The next agent should treat the placeholder patch as a fallback, not the final feature. Keep the no-throw behavior unless a better UX decision is made, because folder imports should not fail just because one PDF has no embedded text.

## Important Code Paths

- PDF extraction entrypoint: `src/lib/content/extractor.ts`, `extractPdfText`
- Direct PDF URL ingestion: `src/lib/content/extractor.ts`, `extractPdfFromUrl`
- Drive PDF ingestion: `src/lib/drive/index.ts`, `readSupportedDriveFile`
- Drive folder import error handling: `src/lib/ingestion/service.ts`, `ingestDriveFolderWithContext`
- Existing Drive/PDF tests: `tests/drive.test.ts`
- Drive ingestion service tests: `tests/drive-ingestion-service.test.ts`

Project language from `CONTEXT.md`: use “Document”, “Drive File”, “Folder Import”, “Derived Document Data”, and “Source Refresh”. Avoid calling Folder Import a sync.

## Suggested Technical Direction

Explore a local-first OCR pipeline, probably optional and dependency-aware:

1. Detect image-only PDFs after pdf.js extraction yields no text.
2. Render PDF pages to images locally.
3. Run OCR on rendered images.
4. Return OCR text if sufficiently non-empty.
5. Fall back to the existing placeholder when OCR is unavailable or yields no text.
6. Surface OCR-unavailable state in a useful error/status if needed, without breaking Folder Import.

Likely implementation choices to evaluate:

- `tesseract.js`: pure JS-ish path but may be heavy and may require language data management.
- System Tesseract CLI: better OCR quality/control, but requires install detection and setup guidance.
- PDF rendering options: pdf.js canvas integration in Node, `sharp`/Poppler if available, or another local renderer. Check Windows support carefully.

Avoid adding network-dependent OCR or sending document images to external services unless the user explicitly asks. This app is privacy-focused and local-first.

## Test Strategy

Start with the existing empty-PDF regression in `tests/drive.test.ts` and add OCR-focused coverage around a seam that can be deterministic.

Recommended test shape:

- Keep `extractPdfText` unit tests for embedded text and image-only fallback.
- Add an injectable OCR/rendering seam, so tests can simulate image-only PDF + OCR output without requiring real Tesseract in CI.
- Add a test that OCR output replaces the placeholder when the OCR provider returns text.
- Add a test that OCR failure/unavailability falls back to the placeholder without throwing.
- Consider a Drive Source Refresh or Folder Import test only if the OCR integration changes service-level behavior.

Run at least:

- `node --test --experimental-strip-types tests/drive.test.ts`
- `npm test`
- `npm run lint`

## Suggested Skills

- `diagnosing-bugs`: use first if reproducing against a real scanned PDF or if OCR integration fails in runtime.
- `do-work`: use for implementation, validation, and commit if the user asks to complete the feature end to end.
- `karpathy-guidelines`: use while designing the OCR seam to keep the change surgical and avoid overengineering.
- `codebase-design`: use only if the OCR provider abstraction starts spreading beyond `content/extractor.ts`.

## Cautions

- There were pre-existing local changes before the placeholder fix. At the time of this handoff, `git status --short` showed only the two files touched by the placeholder fix, but verify current state before editing.
- Do not remove the placeholder fallback unless the user explicitly wants image-only PDFs to fail again.
- Redact or avoid including actual medical document contents in tests, logs, commits, or handoff notes. The failing filename looked medical/personal; do not use real content.
- If adding binary fixtures, keep them tiny and synthetic.
