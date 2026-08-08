export interface ParsedPage {
  number: number;
  text: string;
}

export interface DocumentParser {
  parse(buffer: Buffer): Promise<ParsedPage[]>;
}

// Pure-JS, no native build step, no network call — same bar Phase 4's tokenizer chose
// `gpt-tokenizer` against (docs/Phase6_Implementation_Plan.md §4).
export const pdfDocumentParser: DocumentParser = {
  async parse(buffer: Buffer): Promise<ParsedPage[]> {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.pages
        .map((p) => ({ number: p.num, text: p.text.trim() }))
        .filter((p) => p.text.length > 0);
    } finally {
      await parser.destroy();
    }
  },
};

// DOCX has no native "page" concept (pagination is a rendering-time layout decision, not stored
// in the file) — mammoth extracts raw text only, so this parser synthesizes a "page" per heading
// section, giving citations a stable unit to point at without pretending to know real page
// numbers a Word processor would compute at print time.
export const docxDocumentParser: DocumentParser = {
  async parse(buffer: Buffer): Promise<ParsedPage[]> {
    const mammoth = await import('mammoth');
    const { value: html } = await mammoth.convertToHtml({ buffer });
    const sections = html.split(/(?=<h[1-3][ >])/i).filter((s) => s.trim().length > 0);
    const withText = sections.map((section) => section.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    const nonEmpty = withText.filter((t) => t.length > 0);
    return nonEmpty.length > 0
      ? nonEmpty.map((text, i) => ({ number: i + 1, text }))
      : [{ number: 1, text: '' }];
  },
};

// Markdown/plain text: "pages" are sections split on top-level headings (Markdown) or, for plain
// text with no heading structure, one page per ~1500-character block — same synthetic-page
// reasoning as DOCX, kept consistent so the citation UI has one shape (a page number) regardless
// of source format.
export const plainTextDocumentParser: DocumentParser = {
  async parse(buffer: Buffer): Promise<ParsedPage[]> {
    const text = buffer.toString('utf-8');
    const sections = text.split(/\n(?=#{1,3}\s)/).filter((s) => s.trim().length > 0);
    if (sections.length > 1) {
      return sections.map((s, i) => ({ number: i + 1, text: s.trim() }));
    }
    const CHUNK = 1500;
    const pages: ParsedPage[] = [];
    for (let i = 0; i < text.length; i += CHUNK) {
      const slice = text.slice(i, i + CHUNK).trim();
      if (slice.length > 0) pages.push({ number: pages.length + 1, text: slice });
    }
    return pages.length > 0 ? pages : [{ number: 1, text: text.trim() }];
  },
};

const PARSERS_BY_MIME: Record<string, DocumentParser> = {
  'application/pdf': pdfDocumentParser,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': docxDocumentParser,
  'text/markdown': plainTextDocumentParser,
  'text/plain': plainTextDocumentParser,
};

export const SUPPORTED_FILE_MIME_TYPES = Object.keys(PARSERS_BY_MIME);

export function getDocumentParser(mimeType: string): DocumentParser | undefined {
  return PARSERS_BY_MIME[mimeType];
}
