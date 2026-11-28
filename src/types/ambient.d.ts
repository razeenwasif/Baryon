// Ambient type declarations for Vite compile-time defines, static assets, and untyped packages.
declare const __BARYON_EDITION__: 'core' | 'pro';
declare const __BARYON_FEATURES__: {
  research: boolean;
  reproduce: boolean;
  analytics: boolean;
  academy: boolean;
  notebooks: boolean;
  studio: boolean;
  worlds: boolean;
  game: boolean;
};

declare module '*.css' {
  const styles: Record<string, string>;
  export default styles;
}

declare module '*.png' {
  const src: string;
  export default src;
}
declare module '*.jpg' {
  const src: string;
  export default src;
}
declare module '*.jpeg' {
  const src: string;
  export default src;
}
declare module '*.webp' {
  const src: string;
  export default src;
}
declare module '*.svg' {
  const src: string;
  export default src;
}
declare module '*.mp4' {
  const src: string;
  export default src;
}
declare module '*.vrm' {
  const src: string;
  export default src;
}
declare module '*.woff' {
  const src: string;
  export default src;
}
declare module '*.woff2' {
  const src: string;
  export default src;
}

declare module '*?url' {
  const url: string;
  export default url;
}
declare module '*?url&no-inline' {
  const url: string;
  export default url;
}
declare module '*?raw' {
  const content: string;
  export default content;
}

declare module 'speech-rule-engine' {
  const sre: Record<string, unknown>;
  export = sre;
}
