// ============================================================================
// FILE: elimtiyaz-desktop/src/shared/ui/markdown-view.tsx
// ============================================================================
/**
 * Lightweight, zero-dependency Markdown renderer tailored for the
 * El-Imtiyaz dark UI theme. Supports:
 *   - Tables (| col | col |) with headers & borders
 *   - Headings (h1 - h4)
 *   - Bold (**text**), Italic (*text*), Strikethrough (~~text~~)
 *   - Inline code (`code`) and Code blocks (```lang ... ```)
 *   - Ordered (1.) and Unordered (-, *) lists
 *   - Blockquotes (> quote)
 *   - Links ([text](url))
 */
import React from "react";

interface MarkdownViewProps {
  content: string;
  className?: string;
}

export function MarkdownView({ content, className = "" }: MarkdownViewProps) {
  if (!content) return null;

  const blocks = parseMarkdownBlocks(content);

  return (
    <div className={`space-y-2 text-xs leading-relaxed text-foreground ${className}`}>
      {blocks.map((block, idx) => (
        <React.Fragment key={idx}>{renderBlock(block, idx)}</React.Fragment>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline Tokenizer (Bold, Italic, Code, Links)                      */
/* ------------------------------------------------------------------ */

function renderInline(text: string): React.ReactNode[] {
  if (!text) return [];

  const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(tokenRegex);

  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code
          key={index}
          className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[11px] text-primary"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return (
        <strong key={index} className="font-semibold text-foreground">
          {renderInline(part.slice(2, -2))}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length >= 2) {
      return (
        <em key={index} className="italic text-foreground/90">
          {renderInline(part.slice(1, -1))}
        </em>
      );
    }
    if (part.startsWith("~~") && part.endsWith("~~") && part.length >= 4) {
      return (
        <del key={index} className="line-through text-muted-foreground">
          {renderInline(part.slice(2, -2))}
        </del>
      );
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={index}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline hover:text-primary/80"
        >
          {linkMatch[1]}
        </a>
      );
    }
    return part;
  });
}

/* ------------------------------------------------------------------ */
/*  Block Parser State Machine                                        */
/* ------------------------------------------------------------------ */

type Block =
  | { type: "code"; lang: string; content: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "heading"; level: number; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "hr" }
  | { type: "p"; text: string };

function parseMarkdownBlocks(content: string): Block[] {
  const lines = content.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Code block
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: "code", lang, content: codeLines.join("\n") });
      continue;
    }

    // Markdown Table detection: Line starts/ends with | and next line is |---|---|
    if (
      line.trim().startsWith("|") &&
      line.trim().endsWith("|") &&
      i + 1 < lines.length &&
      /^\|(\s*:?-+:?\s*\|)+$/.test(lines[i + 1].trim())
    ) {
      const headers = splitTableRow(line);
      i += 2; // skip header and divider row
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    // Headings
    if (line.startsWith("# ")) {
      blocks.push({ type: "heading", level: 1, text: line.slice(2).trim() });
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push({ type: "heading", level: 2, text: line.slice(3).trim() });
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      blocks.push({ type: "heading", level: 3, text: line.slice(4).trim() });
      i++;
      continue;
    }
    if (line.startsWith("#### ")) {
      blocks.push({ type: "heading", level: 4, text: line.slice(5).trim() });
      i++;
      continue;
    }

    // Horizontal Rule
    if (/^(---|___|\*\*\*)$/.test(line.trim())) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", text: quoteLines.join("\n") });
      continue;
    }

    // Unordered list (- item or * item)
    if (/^[\*\-]\s+/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && /^[\*\-]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[\*\-]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // Ordered list (1. item)
    if (/^\d+\.\s+/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    // Normal Paragraph
    blocks.push({ type: "p", text: line });
    i++;
  }

  return blocks;
}

function splitTableRow(rowLine: string): string[] {
  // Remove leading and trailing pipes, then split
  const trimmed = rowLine.trim();
  const inner = trimmed.slice(1, trimmed.length - 1);
  return inner.split("|").map((cell) => cell.trim());
}

/* ------------------------------------------------------------------ */
/*  Block Renderer                                                    */
/* ------------------------------------------------------------------ */

function renderBlock(block: Block, key: number) {
  switch (block.type) {
    case "heading": {
      if (block.level === 1) {
        return (
          <h1 className="mt-3 mb-1 text-sm font-bold text-foreground border-b border-border/60 pb-1">
            {renderInline(block.text)}
          </h1>
        );
      }
      if (block.level === 2) {
        return (
          <h2 className="mt-2.5 mb-1 text-xs font-bold text-foreground flex items-center gap-1.5">
            {renderInline(block.text)}
          </h2>
        );
      }
      if (block.level === 3) {
        return (
          <h3 className="mt-2 mb-0.5 text-xs font-semibold text-primary flex items-center gap-1.5">
            {renderInline(block.text)}
          </h3>
        );
      }
      return (
        <h4 className="mt-1.5 mb-0.5 text-[11px] font-semibold text-muted-foreground">
          {renderInline(block.text)}
        </h4>
      );
    }

    case "table": {
      return (
        <div className="my-2.5 overflow-hidden rounded-lg border border-border bg-surface-panel shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] text-left">
              <thead className="border-b border-border bg-muted/40 font-semibold text-foreground">
                <tr>
                  {block.headers.map((h, i) => (
                    <th key={i} className="px-3 py-2">
                      {renderInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {block.rows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-accent/5 transition-colors">
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="px-3 py-1.5">
                        {renderInline(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    case "ul": {
      return (
        <ul className="my-1.5 list-disc list-outside pl-4 space-y-1 text-xs text-foreground">
          {block.items.map((item, idx) => (
            <li key={idx} className="leading-snug">
              {renderInline(item)}
            </li>
          ))}
        </ul>
      );
    }

    case "ol": {
      return (
        <ol className="my-1.5 list-decimal list-outside pl-4 space-y-1 text-xs text-foreground">
          {block.items.map((item, idx) => (
            <li key={idx} className="leading-snug">
              {renderInline(item)}
            </li>
          ))}
        </ol>
      );
    }

    case "code": {
      return (
        <pre className="my-2 overflow-x-auto rounded-lg border border-border/80 bg-black/40 p-3 font-mono text-[11px] text-primary-foreground">
          <code>{block.content}</code>
        </pre>
      );
    }

    case "quote": {
      return (
        <blockquote className="my-2 border-l-2 border-primary/60 bg-primary/5 pl-3 py-1 text-xs italic text-muted-foreground rounded-r">
          {renderInline(block.text)}
        </blockquote>
      );
    }

    case "hr": {
      return <hr className="my-3 border-border/60" />;
    }

    case "p":
    default: {
      return (
        <p className="text-xs leading-relaxed text-foreground">
          {renderInline(block.text)}
        </p>
      );
    }
  }
}