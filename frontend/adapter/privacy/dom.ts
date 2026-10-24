import { privacyMatcher } from "./model";

// Mark existing text elements instead of wrapping/replacing React's text nodes.
// Watching inserted nodes also covers native dialogs, tooltips and command results in portals.
export function maskDocument(document: Document, terms: string[]) {
  let matches = privacyMatcher(terms);
  const marked = new Set<Element>();
  const titles = new Map<Element, string>();
  let originalTitle: string | undefined;
  const hiddenTitle = "MetriBee";
  const scan = (element: Element) => {
    if (element.closest("script,style,noscript,template,[data-privacy-ignore]")) return;
    const title = element.getAttribute("title");
    if (title != null) {
      if (matches(title)) { titles.set(element, title); element.removeAttribute("title"); }
      else titles.delete(element);
    }
    if (element.closest("[data-privacy],.blur-sm,.globe-private")) return;
    const text = [...element.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent || "").join("");
    const field = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : "";
    if (matches(text) || matches(field)) {
      element.setAttribute("data-privacy-detected", ""); marked.add(element);
    } else if (marked.delete(element)) element.removeAttribute("data-privacy-detected");
  };
  const scanTree = (root: Node) => {
    if (root.nodeType === 3) { if (root.parentElement) scan(root.parentElement); return; }
    if (!(root instanceof Element)) return;
    scan(root);
    root.querySelectorAll("*").forEach(scan);
  };
  const pageTitle = () => {
    if (document.title !== hiddenTitle) originalTitle = document.title;
    if (matches(document.title)) document.title = hiddenTitle;
  };
  const observer = new MutationObserver(records => {
    records.forEach(record => {
      if (record.type === "childList") {
        record.addedNodes.forEach(scanTree);
        if (record.target instanceof Element) scan(record.target);
      } else if (record.type === "characterData") scanTree(record.target);
      else if (record.target instanceof Element) scan(record.target);
    });
    pageTitle();
    for (const element of marked) if (!element.isConnected) marked.delete(element);
    for (const element of titles.keys()) if (!element.isConnected) titles.delete(element);
  });
  const input = (event: Event) => { if (event.target instanceof Element) scan(event.target); };
  scanTree(document.body); pageTitle();
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["title", "value"] });
  document.addEventListener("input", input, true);
  document.addEventListener("change", input, true);
  return {
    update(next: string[]) { matches = privacyMatcher(next); scanTree(document.body); pageTitle(); },
    stop() {
      observer.disconnect();
      document.removeEventListener("input", input, true);
      document.removeEventListener("change", input, true);
      marked.forEach(element => element.removeAttribute("data-privacy-detected"));
      titles.forEach((title, element) => { if (!element.hasAttribute("title")) element.setAttribute("title", title); });
      if (originalTitle && document.title === hiddenTitle) document.title = originalTitle;
    },
  };
}
