// Native OOXML "Track Changes" redlining — takes an uploaded .docx as bytes,
// finds the original clause text inside document.xml, and wraps the
// replacement in real <w:ins>/<w:del> runs so the output opens in Word (or
// Google Docs) with genuine, acceptable/rejectable tracked changes — not a
// visual imitation (no colored text tricks, no comments-only workaround).
//
// Why manipulate document.xml directly instead of a "docx" JS library:
// almost every JS docx-writing library (docx, officegen, docxtemplater)
// only *creates* documents from scratch and has no concept of Word's
// revision-tracking schema. Track Changes is a first-class part of the
// OOXML spec (ECMA-376 §17.13.5), so the reliable approach is to unzip the
// .docx (it's a zip of XML parts), inject the <w:ins>/<w:del> elements
// into the existing paragraph runs, and re-zip — preserving every other
// part of the file (styles, headers/footers, tables, images) untouched.
import JSZip from 'jszip';

export interface RedlineEdit {
  /** Exact original text to find inside the document body (verbatim clause). */
  originalText: string;
  /** Replacement text to insert as a tracked insertion. */
  replacementText: string;
  /** Shown in Word's revision tooltip / Reviewing Pane. */
  author?: string;
  /** ISO 8601 timestamp; defaults to now. */
  date?: string;
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/**
 * Apply a set of clause-level redline edits to a .docx file's bytes and
 * return new .docx bytes with genuine OOXML tracked changes.
 *
 * Matching strategy: this operates on the run-concatenated text of each
 * paragraph (<w:p>) rather than a single <w:r>, because Word frequently
 * splits one sentence across several runs (e.g. different formatting
 * mid-sentence). When a paragraph's concatenated text contains
 * `originalText` verbatim, that paragraph's runs are replaced by:
 *   [unchanged prefix run(s)] [w:del wrapping original] [w:ins wrapping
 *   replacement] [unchanged suffix run(s)]
 * preserving the run properties (<w:rPr>) of the first matched run so
 * formatting (bold/italic/font) carries over.
 */
export async function applyRedlines(
  docxBytes: ArrayBuffer | Uint8Array,
  edits: RedlineEdit[],
  defaultAuthor = 'ClauseGuard AI'
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(docxBytes);
  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) {
    throw new Error('Not a valid .docx: word/document.xml is missing');
  }

  const xmlText = await docXmlFile.async('string');
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');

  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Failed to parse document.xml as XML');
  }

  const paragraphs = Array.from(doc.getElementsByTagNameNS(W_NS, 'p'));
  let revisionId = findMaxRevisionId(doc) + 1;

  for (const edit of edits) {
    const author = edit.author ?? defaultAuthor;
    const date = edit.date ?? new Date().toISOString();

    for (const paragraph of paragraphs) {
      const runs = Array.from(paragraph.getElementsByTagNameNS(W_NS, 'r'));
      const paragraphText = runs.map(runText).join('');
      const matchIndex = paragraphText.indexOf(edit.originalText);
      if (matchIndex === -1) continue;

      applyRedlineToParagraph(doc, paragraph, runs, matchIndex, edit, author, date, revisionId);
      revisionId += 2; // one id for the del run, one for the ins run
      break; // one match per edit; re-run applyRedlines for multiple occurrences
    }
  }

  const serializer = new XMLSerializer();
  const newXml = serializer.serializeToString(doc);
  zip.file('word/document.xml', newXml);

  return zip.generateAsync({ type: 'uint8array' });
}

function runText(run: Element): string {
  const texts = run.getElementsByTagNameNS(W_NS, 't');
  let out = '';
  for (let i = 0; i < texts.length; i++) out += texts[i].textContent ?? '';
  return out;
}

function findMaxRevisionId(doc: Document): number {
  let max = 0;
  for (const attr of ['id']) {
    const all = doc.getElementsByTagNameNS(W_NS, 'ins');
    for (let i = 0; i < all.length; i++) {
      const v = parseInt(all[i].getAttributeNS(W_NS, attr) ?? '0', 10);
      if (!Number.isNaN(v)) max = Math.max(max, v);
    }
  }
  return max;
}

function applyRedlineToParagraph(
  doc: Document,
  paragraph: Element,
  runs: Element[],
  matchIndex: number,
  edit: RedlineEdit,
  author: string,
  date: string,
  revisionId: number
): void {
  // Build a flat map of [run, startOffset, endOffset] to locate which run(s)
  // the match spans, then rebuild only the affected runs.
  let offset = 0;
  const runSpans = runs.map((run) => {
    const text = runText(run);
    const span = { run, start: offset, end: offset + text.length, text };
    offset += text.length;
    return span;
  });

  const matchStart = matchIndex;
  const matchEnd = matchIndex + edit.originalText.length;
  const affected = runSpans.filter((s) => s.end > matchStart && s.start < matchEnd);
  if (affected.length === 0) return;

  const templateRun = affected[0].run;
  const rPr = templateRun.getElementsByTagNameNS(W_NS, 'rPr')[0];

  const prefixText = affected[0].text.slice(0, matchStart - affected[0].start);
  const suffixLast = affected[affected.length - 1];
  const suffixText = suffixLast.text.slice(matchEnd - suffixLast.start);

  const newNodes: Element[] = [];
  if (prefixText) newNodes.push(makeRun(doc, prefixText, rPr));
  newNodes.push(makeDelRun(doc, edit.originalText, rPr, author, date, revisionId));
  newNodes.push(makeInsRun(doc, edit.replacementText, rPr, author, date, revisionId + 1));
  if (suffixText) newNodes.push(makeRun(doc, suffixText, rPr));

  const insertBeforeNode = affected[0].run;
  for (const node of newNodes) {
    paragraph.insertBefore(node, insertBeforeNode);
  }
  for (const span of affected) {
    paragraph.removeChild(span.run);
  }
}

function makeRun(doc: Document, text: string, rPr?: Element): Element {
  const run = doc.createElementNS(W_NS, 'w:r');
  if (rPr) run.appendChild(rPr.cloneNode(true));
  const t = doc.createElementNS(W_NS, 'w:t');
  t.setAttribute('xml:space', 'preserve');
  t.textContent = text;
  run.appendChild(t);
  return run;
}

function makeDelRun(doc: Document, text: string, rPr: Element | undefined, author: string, date: string, id: number): Element {
  const del = doc.createElementNS(W_NS, 'w:del');
  del.setAttributeNS(W_NS, 'w:id', String(id));
  del.setAttributeNS(W_NS, 'w:author', author);
  del.setAttributeNS(W_NS, 'w:date', date);

  const run = doc.createElementNS(W_NS, 'w:r');
  if (rPr) run.appendChild(rPr.cloneNode(true));
  const delText = doc.createElementNS(W_NS, 'w:delText');
  delText.setAttribute('xml:space', 'preserve');
  delText.textContent = text;
  run.appendChild(delText);
  del.appendChild(run);
  return del;
}

function makeInsRun(doc: Document, text: string, rPr: Element | undefined, author: string, date: string, id: number): Element {
  const ins = doc.createElementNS(W_NS, 'w:ins');
  ins.setAttributeNS(W_NS, 'w:id', String(id));
  ins.setAttributeNS(W_NS, 'w:author', author);
  ins.setAttributeNS(W_NS, 'w:date', date);

  const run = doc.createElementNS(W_NS, 'w:r');
  if (rPr) run.appendChild(rPr.cloneNode(true));
  const t = doc.createElementNS(W_NS, 'w:t');
  t.setAttribute('xml:space', 'preserve');
  t.textContent = text;
  run.appendChild(t);
  ins.appendChild(run);
  return ins;
}
