import type { ProviderStartOptions, ServerSettings } from "@t3tools/contracts";

export function getServerProviderStartOptions(
  settings: Pick<ServerSettings, "enableCodexBrowserTool" | "providers">,
): ProviderStartOptions | undefined {
  const providerOptions: ProviderStartOptions = {
    ...(settings.providers.codex.binaryPath ||
    settings.providers.codex.homePath ||
    settings.enableCodexBrowserTool
      ? {
          codex: {
            ...(settings.providers.codex.binaryPath
              ? { binaryPath: settings.providers.codex.binaryPath }
              : {}),
            ...(settings.providers.codex.homePath
              ? { homePath: settings.providers.codex.homePath }
              : {}),
            ...(settings.enableCodexBrowserTool ? { enableBrowserTool: true } : {}),
          },
        }
      : {}),
    ...(settings.providers.claudeAgent.binaryPath
      ? {
          claudeAgent: {
            binaryPath: settings.providers.claudeAgent.binaryPath,
          },
        }
      : {}),
    ...(settings.providers.cursor.binaryPath || settings.providers.cursor.apiEndpoint
      ? {
          cursor: {
            ...(settings.providers.cursor.binaryPath
              ? { binaryPath: settings.providers.cursor.binaryPath }
              : {}),
            ...(settings.providers.cursor.apiEndpoint
              ? { apiEndpoint: settings.providers.cursor.apiEndpoint }
              : {}),
          },
        }
      : {}),
    ...(settings.providers.gemini.binaryPath
      ? {
          gemini: {
            binaryPath: settings.providers.gemini.binaryPath,
          },
        }
      : {}),
    ...(settings.providers.opencode.binaryPath ||
    settings.providers.opencode.serverUrl ||
    settings.providers.opencode.serverPassword
      ? {
          opencode: {
            ...(settings.providers.opencode.binaryPath
              ? { binaryPath: settings.providers.opencode.binaryPath }
              : {}),
            ...(settings.providers.opencode.serverUrl
              ? { serverUrl: settings.providers.opencode.serverUrl }
              : {}),
            ...(settings.providers.opencode.serverPassword
              ? { serverPassword: settings.providers.opencode.serverPassword }
              : {}),
          },
        }
      : {}),
  };

  return Object.keys(providerOptions).length > 0 ? providerOptions : undefined;
}
