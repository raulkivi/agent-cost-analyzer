import { MitmproxyLogProvider } from "../../data-sources/log-providers/mitmproxy/mitmproxy-log-provider.js";
import { defaultMitmExchangeDecoders } from "../../data-sources/log-providers/mitmproxy/decoders/default-decoders.js";
import { resolveMitmproxyCapturesDir } from "../../data-sources/log-providers/mitmproxy/resolve-mitmproxy-captures-dir.js";

export interface MitmproxyProviderPaths {
  mitmproxyCapturesDirPath?: string | null;
  // The captures dir defaults to a folder under the app's settings dir.
  appSettingsDir: string;
}

// Standalone app only (vscode-extension.md G11).
export function createMitmproxyProvider(paths: MitmproxyProviderPaths): MitmproxyLogProvider {
  return new MitmproxyLogProvider({
    capturesDirPath:
      paths.mitmproxyCapturesDirPath !== undefined
        ? paths.mitmproxyCapturesDirPath
        : resolveMitmproxyCapturesDir(paths.appSettingsDir),
    decoders: defaultMitmExchangeDecoders,
  });
}
