import { installDesktopBridge } from "./desktopBridge";

await installDesktopBridge();
await import("brocode-web-entry");
