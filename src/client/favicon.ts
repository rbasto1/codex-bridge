const BADGED_FAVICON_REL = "image/png";
const BLUE_DOT_COLOR = "#2563eb";
const ORANGE_DOT_COLOR = "#f59e0b";
const GREEN_DOT_COLOR = "#22c55e";
const DOT_RING_COLOR = "#ffffff";

export type FaviconAttentionState = "default" | "running" | "unread" | "pending";

let baseFaviconHref: string | null = null;
const badgedFaviconHrefPromises: Partial<Record<Exclude<FaviconAttentionState, "default">, Promise<string | null>>> = {};
let lastRequestedState: FaviconAttentionState = "default";

function getFaviconLink(): HTMLLinkElement | null {
  return document.querySelector("link[data-managed-favicon='true'], link[rel~='icon']");
}

function getHead(): HTMLHeadElement | null {
  return document.head ?? document.querySelector("head");
}

function mountManagedFavicon(href: string): void {
  const head = getHead();
  if (!head) {
    return;
  }

  const existingManaged = document.querySelector("link[data-managed-favicon='true']");
  if (existingManaged instanceof HTMLLinkElement) {
    existingManaged.remove();
  }

  const nextLink = document.createElement("link");
  nextLink.rel = "icon";
  nextLink.type = BADGED_FAVICON_REL;
  nextLink.href = href;
  nextLink.setAttribute("data-managed-favicon", "true");
  head.prepend(nextLink);
}

function prepareManagedFavicon(): string | null {
  const head = getHead();
  if (!head) {
    return null;
  }

  const existingManaged = document.querySelector("link[data-managed-favicon='true']");
  if (existingManaged instanceof HTMLLinkElement) {
    baseFaviconHref ??= existingManaged.href;
    return baseFaviconHref;
  }

  const iconLinks = Array.from(document.querySelectorAll("link[rel~='icon']"));
  const firstIconLink = iconLinks.find((element): element is HTMLLinkElement => element instanceof HTMLLinkElement) ?? null;
  baseFaviconHref ??= firstIconLink?.href ?? null;

  for (const link of iconLinks) {
    if (link instanceof HTMLLinkElement) {
      link.remove();
    }
  }

  if (baseFaviconHref) {
    mountManagedFavicon(baseFaviconHref);
  }

  return baseFaviconHref;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load favicon asset: ${src}`));
    image.crossOrigin = "anonymous";
    image.src = src;
  });
}

async function buildBadgedFavicon(baseHref: string, dotColor: string): Promise<string | null> {
  const image = await loadImage(baseHref);
  const size = Math.max(image.naturalWidth, image.naturalHeight, 64);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.drawImage(image, 0, 0, size, size);

  const ringRadius = size * 0.18;
  const dotRadius = size * 0.13;
  const centerX = size - ringRadius - size * 0.05;
  const centerY = size - ringRadius - size * 0.05;

  context.fillStyle = DOT_RING_COLOR;
  context.beginPath();
  context.arc(centerX, centerY, ringRadius, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = dotColor;
  context.beginPath();
  context.arc(centerX, centerY, dotRadius, 0, Math.PI * 2);
  context.fill();

  return canvas.toDataURL(BADGED_FAVICON_REL);
}

export async function syncAttentionFavicon(state: FaviconAttentionState): Promise<void> {
  const preparedBaseHref = prepareManagedFavicon();
  if (!preparedBaseHref) {
    return;
  }

  lastRequestedState = state;
  baseFaviconHref = preparedBaseHref;

  if (state === "default") {
    mountManagedFavicon(baseFaviconHref);
    return;
  }

  const dotColor = state === "pending"
    ? ORANGE_DOT_COLOR
    : state === "unread"
      ? BLUE_DOT_COLOR
      : GREEN_DOT_COLOR;
  badgedFaviconHrefPromises[state] ??= buildBadgedFavicon(baseFaviconHref, dotColor).catch(() => null);
  const badgedHref = await badgedFaviconHrefPromises[state];
  if (!badgedHref || lastRequestedState !== state) {
    return;
  }

  mountManagedFavicon(badgedHref);
}
