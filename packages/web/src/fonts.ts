// The Industry fonts, bundled with the app (vscode-extension.md G12,
// constraint 1: no network call, so no Google Fonts). Only the weights
// theme.css uses: Barlow 400/500/700 and Barlow Condensed 400/600. The
// extension build leaves these out (vite-plugins/omit-modules.ts), since
// the webview uses the editor's font.
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/700.css";
import "@fontsource/barlow-condensed/400.css";
import "@fontsource/barlow-condensed/600.css";
