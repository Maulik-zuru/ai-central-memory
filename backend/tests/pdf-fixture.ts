// A hand-built, minimal multi-page PDF for tests — no real PDF library needed to construct one,
// just the raw object/xref structure pdf.js (which pdf-parse wraps) can read. Keep each page's
// text short: pdf.js's text-layout heuristics truncate long single-line strings written without
// visual word-wrapping (verified empirically while building this fixture), so short strings are
// what make the extraction round-trip exactly.
export function buildTestPdf(pagesText: string[]): Buffer {
  const n = pagesText.length;
  const pageObjNums = Array.from({ length: n }, (_, i) => 3 + n + i);
  const fontObjNum = 3 + 2 * n;
  const objects: Record<number, string> = {};

  objects[1] = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  objects[2] = `2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((x) => `${x} 0 R`).join(' ')}] /Count ${n} >>\nendobj\n`;

  for (let i = 0; i < n; i++) {
    const contentObjNum = 3 + i;
    const stream = `BT /F1 24 Tf 72 700 Td (${pagesText[i]}) Tj ET`;
    objects[contentObjNum] = `${contentObjNum} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`;
  }
  for (let i = 0; i < n; i++) {
    const pageObjNum = pageObjNums[i];
    const contentObjNum = 3 + i;
    objects[pageObjNum] =
      `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 ${fontObjNum} 0 R >> >> ` +
      `/MediaBox [0 0 612 792] /Contents ${contentObjNum} 0 R >>\nendobj\n`;
  }
  objects[fontObjNum] = `${fontObjNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;

  const totalObjs = fontObjNum;
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let i = 1; i <= totalObjs; i++) {
    offsets.push(pdf.length);
    pdf += objects[i];
  }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= totalObjs; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
