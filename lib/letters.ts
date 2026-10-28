import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

// Builds the holiday notice PDFs that the Flask app rendered with wkhtmltopdf
// from templates/letter.html and templates/multiple_letter.html.

type Segment = { text: string; bold?: boolean };

export type LetterFields = {
  date: string;
  holidayStart: string;
  holidayEnd: string;
  purpose: string;
  reopenDate?: string;
};

// "2025-08-15" -> "15-08-2025", like strptime(...).strftime("%d-%m-%Y").
export function formatDate(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export async function buildLetterPdf(fields: LetterFields): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Notice");
  const page = pdf.addPage([595.28, 841.89]); // A4
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const margin = 58;
  const width = page.getWidth() - margin * 2;
  const size = 12;
  const lineHeight = size * 1.6;
  const black = rgb(0, 0, 0);
  let y = page.getHeight() - margin;

  const line = (text: string, align: "left" | "right" | "center", font: PDFFont = regular, fontSize = size) => {
    const w = font.widthOfTextAtSize(text, fontSize);
    const x = align === "left" ? margin : align === "right" ? margin + width - w : margin + (width - w) / 2;
    page.drawText(text, { x, y: y - fontSize, size: fontSize, font, color: black });
    return { x, w };
  };
  const nextLine = (h = lineHeight) => {
    y -= h;
  };

  for (const text of ["From the Office of the Principle,", "M.B.T.S.Govt Polytechnic,", "Guntur"]) {
    line(text, "right");
    nextLine();
  }
  nextLine(lineHeight * 2);

  line(`Date: ${fields.date}`, "right");
  nextLine();
  line("CIRCULAR/HOLIDAY/2025", "left");
  nextLine(lineHeight + 12);

  const heading = line("NOTICE", "center", bold, 15);
  page.drawLine({
    start: { x: heading.x, y: y - 17 },
    end: { x: heading.x + heading.w, y: y - 17 },
    thickness: 0.8,
    color: black,
  });
  nextLine(15 * 1.6 + 22);

  const paragraph: Segment[] = fields.reopenDate
    ? [
        { text: `TO all students of M.B.T.S Government Polytechnic are hereby informed that due to ${fields.purpose}, holidays are declared from ` },
        { text: fields.holidayStart, bold: true },
        { text: " to " },
        { text: fields.holidayEnd, bold: true },
        { text: ". The college will reopen on " },
        { text: fields.reopenDate, bold: true },
        { text: "." },
      ]
    : [
        { text: `TO all students of M.B.T.S Government Polytechnic hereby informed that due to ${fields.purpose}, we are declaring a holiday on ` },
        { text: fields.holidayStart, bold: true },
        { text: ", college will reopen on " },
        { text: fields.holidayEnd, bold: true },
        { text: "." },
      ];

  // Word-wrap the mixed regular/bold paragraph.
  const words = paragraph.flatMap((seg) =>
    seg.text.split(/(\s+)/).filter(Boolean).map((t) => ({ text: t, font: seg.bold ? bold : regular })),
  );
  let x = margin;
  for (const word of words) {
    const isSpace = /^\s+$/.test(word.text);
    const text = isSpace ? " " : word.text;
    const w = word.font.widthOfTextAtSize(text, size);
    if (isSpace) {
      if (x > margin) x += w;
      continue;
    }
    if (x + w > margin + width && x > margin) {
      nextLine();
      x = margin;
    }
    page.drawText(text, { x, y: y - size, size, font: word.font, color: black });
    x += w;
  }
  nextLine(lineHeight * 3);

  line("Thank you", "center", bold);
  nextLine(lineHeight * 3);
  line("PRINCIPAL", "right");

  return pdf.save();
}
