import { useEffect } from "react";
import { useEditor, EditorContent, Extension, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import TextStyle from "@tiptap/extension-text-style";
import { Button } from "@/components/ui/button";
import {
  Bold, Italic, Underline as UnderlineIcon, Heading2, List, ListOrdered,
  Link as LinkIcon, Link2Off, Quote, Undo2, Redo2, RemoveFormatting,
} from "lucide-react";

// Explicit font sizes (owner, 2026-09-14). Rendered as <span style="font-size">
// — the one form every mail client honors — and mirrored by the server
// sanitizer's allowlist, so a size outside this range is stripped on send.
// The email body's own size is 16px; "Default" removes the override.
export const FONT_SIZES = ["12px", "14px", "16px", "18px", "20px", "24px", "28px", "32px"] as const;

// Pasted content can carry any size in any unit (48px, 18pt, 1.5em). Snap it to
// the nearest offered size on the way in, so what Write shows is what the
// sanitizer lets through on send; anything unparseable loses its size.
function normalizeFontSize(raw: string): string | null {
  const m = /^\s*([\d.]+)\s*(px|pt|em|rem|%)\s*$/i.exec(raw);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = m[2].toLowerCase();
  const px = unit === "px" ? n : unit === "pt" ? n * 4 / 3 : unit === "%" ? n / 100 * 16 : n * 16;
  return FONT_SIZES.reduce((best, s) => (Math.abs(parseInt(s) - px) < Math.abs(parseInt(best) - px) ? s : best));
}

// Every distinct size across the selection ("" = no override). More than one
// means the dropdown shows Mixed instead of silently reporting the first run.
function selectionFontSizes(editor: Editor): Set<string> {
  const { from, to, empty } = editor.state.selection;
  if (empty) return new Set([(editor.getAttributes("textStyle").fontSize as string | null) ?? ""]);
  const sizes = new Set<string>();
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    const mark = node.marks.find((mk) => mk.type.name === "textStyle");
    sizes.add((mark?.attrs.fontSize as string | null) ?? "");
  });
  return sizes;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

const FontSize = Extension.create({
  name: "fontSize",
  addGlobalAttributes() {
    return [{
      types: ["textStyle"],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (element) => (element.style.fontSize ? normalizeFontSize(element.style.fontSize) : null),
          renderHTML: (attributes) => (attributes.fontSize ? { style: `font-size: ${attributes.fontSize}` } : {}),
        },
      },
    }];
  },
  addCommands() {
    return {
      setFontSize: (size) => ({ chain }) => chain().setMark("textStyle", { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }) => chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});

/**
 * Rich-text editor for campaign bodies (owner, 2026-09-12: "a better WYSIWYG
 * experience"). Tiptap/ProseMirror underneath: a real toolbar, the usual
 * keyboard shortcuts (Ctrl/Cmd+B, I, U, Z), and paste handling that turns a
 * Google Docs or Word paste into clean semantic HTML — bold spans become
 * <strong>, lists stay lists. Output is getHTML(): exactly the tag set the
 * server's sanitizer allows, so what's shown here is what gets wrapped in the
 * brand template.
 */
export function CampaignEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        // Not in the email allowlist — keep the toolbar honest.
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
      }),
      Underline,
      TextStyle,
      FontSize,
      Link.configure({ openOnClick: false, autolink: true, defaultProtocol: "https" }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none min-h-56 px-3 py-2 focus:outline-none",
        // The visible "Body" label can't associate with a contenteditable div,
        // so the textbox names itself for screen readers.
        role: "textbox",
        "aria-label": "Email body",
        "aria-multiline": "true",
        "data-testid": "editor-campaign-body",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? "" : editor.getHTML()),
  });

  // Keep an externally-reset value (e.g. after a send) in sync without
  // clobbering the caret while the user is typing.
  useEffect(() => {
    if (editor && value === "" && !editor.isEmpty) editor.commands.clearContent();
  }, [editor, value]);

  if (!editor) return null;

  const setLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link address (https://…)", previous ?? "https://");
    if (url === null) return;
    const trimmed = url.trim();
    if (!trimmed || trimmed === "https://") { editor.chain().focus().unsetLink().run(); return; }
    if (!/^https?:\/\//i.test(trimmed)) { window.alert("Links need to start with http:// or https://"); return; }
    editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run();
  };

  return (
    <div className="rounded-md border bg-card focus-within:ring-2 focus-within:ring-ring">
      <Toolbar editor={editor} onLink={setLink} />
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor, onLink }: { editor: Editor; onLink: () => void }) {
  const btn = (label: string, active: boolean, onClick: () => void, Icon: typeof Bold, disabled = false, testId?: string) => (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="icon"
      className="h-8 w-8"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      data-testid={testId}
    >
      <Icon className="w-4 h-4" />
    </Button>
  );
  const c = () => editor.chain().focus();
  const sizes = selectionFontSizes(editor);
  const currentSize = sizes.size > 1 ? "mixed" : Array.from(sizes)[0] ?? "";
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1" role="toolbar" aria-label="Formatting">
      {btn("Bold (Ctrl+B)", editor.isActive("bold"), () => c().toggleBold().run(), Bold, false, "button-format-bold")}
      {btn("Italic (Ctrl+I)", editor.isActive("italic"), () => c().toggleItalic().run(), Italic)}
      {btn("Underline (Ctrl+U)", editor.isActive("underline"), () => c().toggleUnderline().run(), UnderlineIcon)}
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      {/* A selection spanning several sizes shows Mixed; picking a size applies
          it to the whole selection (or, with no selection, to what's typed next). */}
      <select
        className="h-8 rounded-md border bg-background px-1.5 text-sm"
        value={currentSize === "mixed" || FONT_SIZES.includes(currentSize as (typeof FONT_SIZES)[number]) ? currentSize : ""}
        onChange={(e) => (e.target.value ? c().setFontSize(e.target.value).run() : c().unsetFontSize().run())}
        aria-label="Font size"
        title="Font size"
        data-testid="select-font-size"
      >
        <option value="mixed" disabled>Mixed</option>
        <option value="">Default</option>
        {FONT_SIZES.map((s) => <option key={s} value={s}>{s.replace("px", "")}</option>)}
      </select>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      {btn("Heading", editor.isActive("heading", { level: 2 }), () => c().toggleHeading({ level: 2 }).run(), Heading2)}
      {btn("Bulleted list", editor.isActive("bulletList"), () => c().toggleBulletList().run(), List, false, "button-format-bullets")}
      {btn("Numbered list", editor.isActive("orderedList"), () => c().toggleOrderedList().run(), ListOrdered)}
      {btn("Quote", editor.isActive("blockquote"), () => c().toggleBlockquote().run(), Quote)}
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      {btn("Link", editor.isActive("link"), onLink, LinkIcon, false, "button-format-link")}
      {btn("Remove link", false, () => c().unsetLink().run(), Link2Off, !editor.isActive("link"))}
      {btn("Clear formatting", false, () => c().clearNodes().unsetAllMarks().run(), RemoveFormatting)}
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      {btn("Undo (Ctrl+Z)", false, () => c().undo().run(), Undo2, !editor.can().undo())}
      {btn("Redo (Ctrl+Shift+Z)", false, () => c().redo().run(), Redo2, !editor.can().redo())}
    </div>
  );
}
