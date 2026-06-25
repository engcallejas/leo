"use client";

import { Fragment } from "react";

/**
 * Tiny, dependency-free, safe markdown renderer (no dangerouslySetInnerHTML).
 * Supports headings, paragraphs, ordered/unordered lists, blockquotes, code
 * fences, horizontal rules, and inline **bold** / `code` / [links](url).
 * Deliberately small — enough to make refined specs and step results readable.
 */
export function Markdown({
  text,
  size = 13,
}: {
  text: string;
  size?: number;
}) {
  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushList = () => {
    if (!list) return;
    const items = list.items;
    const Tag = list.ordered ? "ol" : "ul";
    out.push(
      <Tag key={key++} style={{ margin: "6px 0", paddingLeft: 22 }}>
        {items.map((li, idx) => (
          <li key={idx} style={{ fontSize: size, lineHeight: 1.65, margin: "2px 0" }}>
            {inline(li)}
          </li>
        ))}
      </Tag>,
    );
    list = null;
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block.
    if (line.trimStart().startsWith("```")) {
      flushList();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        buf.push(lines[i++]);
      }
      i++; // closing fence
      out.push(
        <pre
          key={key++}
          className="mono"
          style={{
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            padding: 10,
            borderRadius: 8,
            fontSize: size - 1,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            margin: "8px 0",
          }}
        >
          {buf.join("\n")}
        </pre>,
      );
      continue;
    }

    // Horizontal rule.
    if (/^\s*([-*_])\1\1[-*_\s]*$/.test(line)) {
      flushList();
      out.push(
        <hr
          key={key++}
          style={{ border: "none", borderTop: "1px solid var(--border)", margin: "12px 0" }}
        />,
      );
      i++;
      continue;
    }

    // Heading.
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushList();
      const level = h[1].length;
      const fs = level <= 1 ? 17 : level === 2 ? 15 : 13.5;
      out.push(
        <div
          key={key++}
          style={{
            fontWeight: 700,
            fontSize: fs,
            margin: out.length ? "14px 0 4px" : "0 0 4px",
            color: level <= 2 ? "var(--text)" : "var(--text)",
          }}
        >
          {inline(h[2])}
        </div>,
      );
      i++;
      continue;
    }

    // Blockquote.
    if (/^\s*>\s?/.test(line)) {
      flushList();
      out.push(
        <div
          key={key++}
          style={{
            borderLeft: "3px solid var(--border-strong)",
            paddingLeft: 10,
            margin: "6px 0",
            color: "var(--muted)",
            fontSize: size,
          }}
        >
          {inline(line.replace(/^\s*>\s?/, ""))}
        </div>,
      );
      i++;
      continue;
    }

    // Ordered list item.
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ol) {
      if (list && !list.ordered) flushList();
      (list ??= { ordered: true, items: [] }).items.push(ol[1]);
      list.ordered = true;
      i++;
      continue;
    }

    // Unordered list item.
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (ul) {
      if (list && list.ordered) flushList();
      (list ??= { ordered: false, items: [] }).items.push(ul[1]);
      i++;
      continue;
    }

    // Blank line.
    if (line.trim() === "") {
      flushList();
      i++;
      continue;
    }

    // Paragraph.
    flushList();
    out.push(
      <p key={key++} style={{ fontSize: size, lineHeight: 1.65, margin: "5px 0" }}>
        {inline(line)}
      </p>,
    );
    i++;
  }
  flushList();
  return <div className="md">{out}</div>;
}

/** Inline parser: **bold**, `code`, [text](url). */
function inline(s: string): React.ReactNode {
  const tokens: React.ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last)
      tokens.push(<Fragment key={k++}>{s.slice(last, m.index)}</Fragment>);
    if (m[2]) tokens.push(<strong key={k++}>{m[2]}</strong>);
    else if (m[4])
      tokens.push(
        <code
          key={k++}
          className="mono"
          style={{
            fontSize: "0.92em",
            background: "var(--panel-2)",
            padding: "1px 5px",
            borderRadius: 5,
            border: "1px solid var(--border)",
          }}
        >
          {m[4]}
        </code>,
      );
    else if (m[6])
      tokens.push(
        <a
          key={k++}
          href={m[7]}
          target="_blank"
          rel="noreferrer"
          style={{ color: "var(--accent)" }}
        >
          {m[6]}
        </a>,
      );
    last = re.lastIndex;
  }
  if (last < s.length) tokens.push(<Fragment key={k++}>{s.slice(last)}</Fragment>);
  return tokens;
}
