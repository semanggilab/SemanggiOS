"use client";

// Perender markdown minimal — dipakai balasan chat, modal dokumen, dan panel
// viewer berkas (D73).
//
// Dipindahkan keluar dari control-page.tsx saat panel viewer lahir: tiga
// permukaan yang merender markdown yang sama harus merendernya dengan cara
// yang sama persis, dan satu-satunya cara memastikan itu adalah satu salinan.
//

import type { ReactNode } from "react";

/**
 * Minimal markdown renderer — headings, lists (including the `- [ ]` task
 * checkboxes plans.md is specified to use), fenced code, blockquotes, rules,
 * and inline emphasis/code/links. Hand-rolled because the fork must not gain
 * an npm dependency for one read-only view, and because the documents this
 * renders are the repo's own planning docs whose constructs this covers.
 */
/**
 * Nama berkas workspace di dalam sebuah balasan — `docs/plans.md`,
 * `memory/decisions.md`, `deliverables/TASK-XXXX/laporan.md`.
 *
 * Dibatasi pada tiga akar itu SAJA, dan itu disengaja: sebuah balasan penuh
 * potongan kode juga memuat `useState` dan `node:fs` di dalam backtick, dan
 * menjadikan semuanya tombol berarti kebanyakan tombol tidak membuka apa pun.
 * Tiga akar ini adalah persis yang bisa dibuka panel viewer (D73), jadi
 * setiap yang terlihat bisa diklik memang benar-benar bisa dibuka.
 */
const FILE_TOKEN = /^(?:docs|memory|deliverables)\/[A-Za-z0-9._\-/]+\.[A-Za-z0-9]+$/;

export function MarkdownView({
  content,
  onOpenFile,
}: {
  content: string;
  /** Dipasang halaman Command Center; tanpa ini nama berkas tetap kode biasa. */
  onOpenFile?: (path: string) => void;
}) {
  const blocks: ReactNode[] = [];
  const lines = content.split("\n");
  let i = 0;
  let key = 0;

  const renderInline = (text: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
    let last = 0;
    let match: RegExpExecArray | null;
    let k = 0;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > last) parts.push(text.slice(last, match.index));
      const token = match[0];
      if (token.startsWith("**")) parts.push(<strong key={k++}>{token.slice(2, -2)}</strong>);
      else if (token.startsWith("`")) {
        const inner = token.slice(1, -1);
        // Nama berkas menjadi tombol yang membuka panel viewer. `stopPropagation`
        // wajib: gelembung balasan yang menyebut sebuah task juga bisa diklik
        // untuk membuka dialog task, dan satu klik tidak boleh melakukan dua hal.
        if (onOpenFile && FILE_TOKEN.test(inner)) {
          parts.push(
            <button
              key={k++}
              type="button"
              title={`Buka ${inner} di panel viewer`}
              onClick={(event) => {
                event.stopPropagation();
                onOpenFile(inner);
              }}
              className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-primary underline decoration-dotted underline-offset-2 transition-colors hover:bg-accent"
            >
              {inner}
            </button>,
          );
        } else {
          parts.push(
            <code key={k++} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
              {inner}
            </code>,
          );
        }
      }
      else if (token.startsWith("[")) {
        const m = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
        parts.push(
          <a key={k++} href={m?.[2] ?? "#"} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
            {m?.[1] ?? token}
          </a>,
        );
      } else parts.push(<em key={k++}>{token.slice(1, -1)}</em>);
      last = match.index + token.length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={key++} className="overflow-x-auto rounded-md border border-border bg-muted/50 p-2 text-[0.8em] leading-relaxed">
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      // GFM table: header row, dashed separator, body rows. plans.md dan
      // breakdown dokumen lain memakainya — merender garis pipi mentah di
      // viewer yang seharusnya memformat markdown akan mengalahkan tujuan
      // viewer itu sendiri.
      const splitRow = (row: string) =>
        row
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
      const header = splitRow(lines[i]);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        body.push(splitRow(lines[i]));
        i++;
      }
      blocks.push(
        <div key={key++} className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/50">
              <tr>
                {header.map((cell, ci) => (
                  <th key={ci} className="px-2 py-1 font-medium">
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri} className="border-t border-border/60">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-2 py-1">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const size = ["text-lg", "text-base", "text-sm", "text-sm"][heading[1].length - 1];
      blocks.push(
        <p key={key++} className={`${size} font-semibold pt-1`}>
          {renderInline(heading[2])}
        </p>,
      );
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="border-border/60" />);
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) quote.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(
        <blockquote key={key++} className="border-l-2 border-border pl-2 text-muted-foreground">
          {renderInline(quote.join(" "))}
        </blockquote>,
      );
      continue;
    }
    // Three checkbox states, mirroring the register flow's marks: `[ ]` open,
    // `[-]` registered in the controller (written back by registerTasks), and
    // `[x]` done. A `[-]` row is alive in the system, so it gets a neutral
    // filled glyph — not an empty box (which reads "never touched") and not
    // a strike-through (which reads "finished").
    const task = line.match(/^\s*- \[( |x|X|-)\]\s+(.*)$/);
    if (task) {
      blocks.push(
        <div key={key++} className="flex items-start gap-1.5">
          <span className={task[1] === " " ? "text-muted-foreground" : task[1] === "-" ? "text-sky-500" : "text-emerald-500"}>
            {task[1] === " " ? "☐" : task[1] === "-" ? "▣" : "☑"}
          </span>
          <span className={task[1].toLowerCase() === "x" ? "text-muted-foreground line-through" : ""}>{renderInline(task[2])}</span>
        </div>,
      );
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      blocks.push(
        <div key={key++} className="flex items-start gap-1.5">
          <span className="text-muted-foreground">•</span>
          <span>{renderInline(line.replace(/^\s*[-*]\s+/, ""))}</span>
        </div>,
      );
      i++;
      continue;
    }
    const ordered = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (ordered) {
      blocks.push(
        <div key={key++} className="flex items-start gap-1.5">
          <span className="text-muted-foreground">{ordered[1]}.</span>
          <span>{renderInline(ordered[2])}</span>
        </div>,
      );
      i++;
      continue;
    }
    if (line.trim() === "") {
      blocks.push(<div key={key++} className="h-1.5" />);
      i++;
      continue;
    }
    blocks.push(<p key={key++} className="leading-relaxed">{renderInline(line)}</p>);
    i++;
  }
  return <div className="space-y-1 text-sm">{blocks}</div>;
}
