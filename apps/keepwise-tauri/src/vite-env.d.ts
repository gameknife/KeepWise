/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FORCE_MOBILE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "qrcode" {
  export function toDataURL(
    text: string,
    options?: Record<string, unknown>,
  ): Promise<string>;
}
