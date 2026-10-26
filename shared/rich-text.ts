export type RichNode = { tag: string; text?: string; href?: string; children: RichNode[] };

function decode(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    if (!code.startsWith("#")) return named[code.toLowerCase()] ?? entity;
    const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : "";
  });
}

export function contentUrl(value: string, base: string): string | undefined {
  try {
    const decoded = decode(value).trim();
    if (!decoded || /[\u0000-\u0020\u007f]/.test(decoded) || decoded.length > 4096) return;
    const url = new URL(decoded, base);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return;
    return url.href;
  } catch { return; }
}

/** Parse only reading structure; no raw HTML, styles or event handlers reach the UI. */
export function parseRichText(html: string, base: string): RichNode[] {
  const root: RichNode = { tag: "root", children: [] };
  const stack = [root];
  const blocked = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "template"]);
  const supported = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "code", "a", "img", "br", "hr", "strong", "b", "em", "i", "u", "s", "table", "thead", "tbody", "tfoot", "tr", "th", "td"]);
  const voidTags = new Set(["img", "br", "hr", "input", "meta", "link", "embed"]);
  let suppressed: string | null = null;
  const hasMarkup = /<[a-z]/i.test(html);
  for (const token of html.match(/<!--[\s\S]*?(?:-->|$)|<(?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+|</g) ?? []) {
    if (token.startsWith("<!--")) continue;
    const element = /^<\s*(\/?)\s*([a-z][\w-]*)\b([\s\S]*?)>$/i.exec(token);
    if (element) {
      const [, closing, rawTag, attributes] = element;
      const tag = rawTag.toLowerCase();
      if (suppressed) { if (closing && tag === suppressed) suppressed = null; continue; }
      if (blocked.has(tag)) { if (!closing && !voidTags.has(tag)) suppressed = tag; continue; }
      if (closing) {
        const index = stack.map(node => node.tag).lastIndexOf(tag);
        if (index > 0) stack.length = index;
        continue;
      }
      if (!supported.has(tag)) continue;
      const attrs: Record<string, string> = {};
      for (const match of attributes.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
        attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
      }
      const node: RichNode = { tag, children: [] };
      if (tag === "a" || tag === "img") node.href = contentUrl(attrs[tag === "a" ? "href" : "src"] ?? "", base);
      if (tag === "img") node.text = decode(attrs.alt ?? "图片");
      stack[stack.length - 1].children.push(node);
      // Bound nesting, while retaining text for unusually deep source markup.
      if (!voidTags.has(tag) && !/\/\s*$/.test(attributes) && stack.length < 32) stack.push(node);
    } else if (!suppressed && !token.startsWith("<!")) {
      stack[stack.length - 1].children.push({ tag: "text", text: stack.some(node => node.tag === "pre") || !hasMarkup ? decode(token) : decode(token).replace(/\s+/g, " "), children: [] });
    }
  }
  return root.children;
}

/** Only site-local TAPD images use the authenticated image metadata endpoint. */
export function tapdImagePath(source: string | undefined, base: string): string | undefined {
  try {
    if (!source) return;
    const url = new URL(source);
    if (url.origin === new URL(base).origin && !url.username && !url.password
      && /^\/tfl\/(?:captures|pictures)\/.+\.(?:png|gif|jpe?g|bmp)$/i.test(url.pathname)) return url.pathname;
  } catch { return; }
}
