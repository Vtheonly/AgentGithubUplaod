import { PDFDocument, PDFRawStream, PDFArray } from "pdf-lib";
import zlib from "node:zlib";

function decodeDrawnStrings(content: string): string[] {
  const out: string[] = [];
  for (const m of content.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
    const hex = m[1].replace(/\s+/g, "");
    let s = "";
    for (let i = 0; i + 1 < hex.length; i += 2) {
      s += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
    }
    out.push(s);
  }
  for (const m of content.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) {
    out.push(m[1].replace(/\\([()\\])/g, "$1"));
  }
  return out;
}

export async function extractText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages: string[] = [];
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    let text = "";
    const collect = (obj: unknown) => {
      if (obj instanceof PDFRawStream) {
        text += zlib.inflateSync(Buffer.from(obj.getContents())).toString("latin1");
      }
    };
    if (contents instanceof PDFArray) {
      for (let i = 0; i < contents.size(); i++) {
        collect(doc.context.lookup(contents.get(i)));
      }
    } else {
      collect(doc.context.lookup(contents));
    }
    pages.push(decodeDrawnStrings(text).join("\u000a"));
  }
  return pages.join("\u000a");
}

