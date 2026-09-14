import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, Extension, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import TextStyle from "@tiptap/extension-text-style";
import Image from "@tiptap/extension-image";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Bold, Italic, Underline as UnderlineIcon, Heading2, List, ListOrdered,
  Link as LinkIcon, Link2Off, Quote, Undo2, Redo2, RemoveFormatting, ImagePlus, Loader2,
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

// Photos (owner, 2026-09-14). Block-level, never base64 (an inlined photo would
// balloon the email). The `width` attribute is the DISPLAY width the upload
// endpoint chose — Outlook for Windows ignores max-width, so the <img> must say
// how wide it is; every other client scales it down with the sanitizer's style.
const CampaignImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => element.getAttribute("width"),
        renderHTML: (attributes) => (attributes.width ? { width: String(attributes.width) } : {}),
      },
    };
  },
}).configure({ inline: false, allowBase64: false });

type UploadedPhoto = { url: string; width: number };

async function uploadPhoto(file: File): Promise<UploadedPhoto> {
  const res = await fetch("/api/admin/email-campaign/image", {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as { message?: string }));
    throw new Error(body.message || `Upload failed (${res.status})`);
  }
  return res.json();
}

const imageFiles = (list: FileList | null | undefined): File[] =>
  Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));

/**
 * Rich-text editor for campaign bodies (owner, 2026-09-12: "a better WYSIWYG
 * experience"). Tiptap/ProseMirror underneath: a real toolbar, the usual
 * keyboard shortcuts (Ctrl/Cmd+B, I, U, Z), and paste handling that turns a
 * Google Docs or Word paste into clean semantic HTML — bold spans become
 * <strong>, lists stay lists. Output is getHTML(): exactly the tag set the
 * server's sanitizer allows, so what's shown here is what gets wrapped in the
 * brand template. Photos arrive by toolbar button, drag-and-drop, or pasting
 * an image file; each is uploaded (as email-safe JPEG) and inserted by URL.
 */
export function CampaignEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // editorProps are captured once at creation, so the drop/paste handlers reach
  // the current insert function through a ref.
  const insertRef = useRef<(file: File, pos?: number) => void>(() => {});

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
      CampaignImage,
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
      // Dropped or pasted image FILES are uploaded and inserted where they
      // land; anything else (text, HTML, a moved node) takes the default path.
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = imageFiles(event.dataTransfer?.files);
        if (files.length === 0) return false;
        event.preventDefault();
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        files.forEach((f) => insertRef.current(f, pos));
        return true;
      },
      handlePaste: (_view, event) => {
        const files = imageFiles(event.clipboardData?.files);
        if (files.length === 0) return false;
        event.preventDefault();
        files.forEach((f) => insertRef.current(f));
        return true;
      },
    },
    onUpdate: ({ editor }) => onChange(editor.isEmpty ? "" : editor.getHTML()),
  });

  insertRef.current = async (file: File, pos?: number) => {
    if (!editor) return;
    setUploading((n) => n + 1);
    try {
      const photo = await uploadPhoto(file);
      const node = { type: "image", attrs: { src: photo.url, alt: "", width: photo.width } };
      const chain = editor.chain().focus();
      (pos != null ? chain.insertContentAt(pos, node) : chain.insertContent(node)).run();
    } catch (e: any) {
      toast({ title: "Couldn't add the photo", description: e?.message || "Try again.", variant: "destructive" });
    } finally {
      setUploading((n) => n - 1);
    }
  };

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
      {/* A selected photo needs a visible state so Backspace/Delete on it isn't a guess. */}
      <style>{`.ProseMirror img.ProseMirror-selectednode { outline: 3px solid hsl(var(--ring)); outline-offset: 2px; }`}</style>
      <Toolbar editor={editor} onLink={setLink} onPhoto={() => fileInputRef.current?.click()} uploading={uploading > 0} />
      <EditorContent editor={editor} />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          imageFiles(e.target.files).forEach((f) => insertRef.current(f));
          e.target.value = "";
        }}
        data-testid="input-campaign-photo"
      />
    </div>
  );
}

function Toolbar({ editor, onLink, onPhoto, uploading }: { editor: Editor; onLink: () => void; onPhoto: () => void; uploading: boolean }) {
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
      {btn(uploading ? "Adding photo…" : "Add photo", false, onPhoto, uploading ? Loader2 : ImagePlus, uploading, "button-format-photo")}
      {btn("Clear formatting", false, () => c().clearNodes().unsetAllMarks().run(), RemoveFormatting)}
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      {btn("Undo (Ctrl+Z)", false, () => c().undo().run(), Undo2, !editor.can().undo())}
      {btn("Redo (Ctrl+Shift+Z)", false, () => c().redo().run(), Redo2, !editor.can().redo())}
    </div>
  );
}
