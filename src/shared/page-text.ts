const GROUPING_PAGE_SELECTORS = ['article', '[role="main"]', 'main'] as const;
const GROUPING_PAGE_TEXT_LIMIT = 900;

type GroupingTextNode = { innerText?: string } | null | undefined;
type GroupingDocument = {
  querySelector: (selector: string) => GroupingTextNode;
  body?: GroupingTextNode;
};

function normalizeGroupingText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, GROUPING_PAGE_TEXT_LIMIT);
}

export function extractGroupingPageTextFrom(doc: GroupingDocument): string {
  for (const selector of GROUPING_PAGE_SELECTORS) {
    const text = normalizeGroupingText(doc.querySelector(selector)?.innerText);
    if (text) return text;
  }
  return normalizeGroupingText(doc.body?.innerText);
}

/** Injected via executeScript. Must not close over module bindings. */
export function extractGroupingPageTextInPage(): string {
  for (const selector of ['article', '[role="main"]', 'main'] as const) {
    const text = ((document.querySelector(selector) as HTMLElement | null)?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 900);
    if (text) return text;
  }
  return (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 900);
}
