import type { DesktopBridge } from "@t3tools/contracts";

declare global {
  interface ImportMetaEnv {
    readonly APP_VERSION: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    nativeApi?: unknown;
    desktopBridge?: DesktopBridge;
  }
}
