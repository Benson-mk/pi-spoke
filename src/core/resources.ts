export type ResourceFile = { path: string; hash: string; content: string };
export type ImageResource = { path: string; source: string; hash: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' };
export type SkillResource = { id: string; name: string; description: string; path: string; baseDir: string; hash: string };
export type ResourceManifest = { context: ResourceFile[]; images: ImageResource[]; skills: SkillResource[] };
