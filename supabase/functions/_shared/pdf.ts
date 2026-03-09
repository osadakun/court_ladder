export function createSimplePdf(lines: string[]): Uint8Array {
  const pageWidth = 595;
  const pageHeight = 842;
  const marginTop = 48;
  const marginLeft = 40;
  const fontSize = 10;
  const lineHeight = 14;
  const maxLinesPerPage = Math.floor((pageHeight - marginTop * 2) / lineHeight);
  const pages: string[][] = [];

  for (let i = 0; i < lines.length; i += maxLinesPerPage) {
    pages.push(lines.slice(i, i + maxLinesPerPage));
  }

  const objects: string[] = [];
  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const fontObjectId = addObject(
    "<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiKakuGo-W5 /Encoding /UniJIS-UCS2-H /DescendantFonts [<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiKakuGo-W5 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> >>] >>",
  );
  const pageObjectIds: number[] = [];

  for (const pageLines of pages) {
    const commands = [
      "BT",
      `/F1 ${fontSize} Tf`,
      `${marginLeft} ${pageHeight - marginTop} Td`,
    ];

    pageLines.forEach((line, index) => {
      if (index > 0) commands.push(`0 -${lineHeight} Td`);
      commands.push(`<${encodePdfText(line)}> Tj`);
    });
    commands.push("ET");

    const content = commands.join("\n");
    const contentObjectId = addObject(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const pageObjectId = addObject(
      `<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
    );
    pageObjectIds.push(pageObjectId);
  }

  const pagesObjectId = addObject(
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`,
  );
  const catalogObjectId = addObject(`<< /Type /Catalog /Pages ${pagesObjectId} 0 R >>`);

  for (const pageObjectId of pageObjectIds) {
    objects[pageObjectId - 1] = objects[pageObjectId - 1].replace("/Parent 0 0 R", `/Parent ${pagesObjectId} 0 R`);
  }

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];

  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${offsets[i].toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObjectId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

function encodePdfText(text: string): string {
  const bytes: number[] = [0xfe, 0xff];
  for (const ch of text) {
    const codePoint = ch.codePointAt(0)!;
    if (codePoint <= 0xffff) {
      bytes.push((codePoint >> 8) & 0xff, codePoint & 0xff);
      continue;
    }

    const adjusted = codePoint - 0x10000;
    const high = 0xd800 + (adjusted >> 10);
    const low = 0xdc00 + (adjusted & 0x3ff);
    bytes.push((high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff);
  }
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}
