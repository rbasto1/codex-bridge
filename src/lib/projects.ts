import type { ProjectStateEntry } from "../types";

export function encodeProjectId(project: string): string {
  return btoa(project).replace(/[/+=]/g, "_");
}

export function encodeProjectStateId(project: string): string {
  return project.replace(/-/g, "--").replace(/\//g, "-");
}

export function formatProjectTileLabel(project: string): string {
  const baseName = project.split("/").filter(Boolean).pop() ?? project;
  const parts = baseName.split(/[^a-zA-Z0-9]+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }

  return baseName.slice(0, 2).toUpperCase();
}

export function reorderProjectEntries(
  visibleProjects: string[],
  previousEntries: ProjectStateEntry[],
): ProjectStateEntry[] {
  return visibleProjects.map((project) => {
    const existing = previousEntries.find((entry) => entry.id === project);
    return existing ?? { id: project, name: "" };
  });
}

export async function resizeImageFileToPngBlob(file: File, size = 64): Promise<Blob> {
  const image = await loadImageFromFile(file);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is unavailable.");
  }

  context.drawImage(image, 0, 0, size, size);
  URL.revokeObjectURL(image.src);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to convert the project icon to PNG."));
        return;
      }

      resolve(blob);
    }, "image/png");
  });
}

async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image "${file.name}".`));
    image.src = URL.createObjectURL(file);
  });
}
