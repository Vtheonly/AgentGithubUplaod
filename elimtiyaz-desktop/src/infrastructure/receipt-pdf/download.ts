/**
 * Download helper (browser / Electron renderer).
 *
 * Uses the Blob + URL.createObjectURL pattern to trigger a client-side
 * download of the PDF byte array produced by the generator functions.
 */
export function downloadPdf(bytes: Uint8Array, filename: string) {
  // Cast to BlobPart for compatibility with TS 5.7+ Blob typing
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
