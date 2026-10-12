import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Platform, View, useWindowDimensions } from "react-native";
import RenderHTML from "react-native-render-html";
import { WebView as NativeWebView } from "react-native-webview";

import { useResolvedColorScheme } from "@/core/hooks/useColorScheme";
import { useTheme } from "@/core/theme";
import { Card, Text } from "@/shared/components";

export type EventHtmlBlock = {
  id?: string | null;
  html?: string | null;
};

type HtmlThemeTokens = {
  isDarkMode: boolean;
  background: string;
  surface: string;
  card: string;
  soft: string;
  textPrimary: string;
  textSecondary: string;
  accent: string;
  border: string;
};

function buildHtmlCss(theme: HtmlThemeTokens): string {
  return `
:root, html, body {
	color-scheme: ${theme.isDarkMode ? "dark" : "light"} !important;
	background-color: ${theme.background} !important;
	color: ${theme.textPrimary} !important;
	--bg: ${theme.background};
	--background: ${theme.background};
	--surface: ${theme.surface};
	--card: ${theme.card};
	--soft: ${theme.soft};
	--text: ${theme.textPrimary};
	--text-color: ${theme.textPrimary};
	--foreground: ${theme.textPrimary};
	--muted: ${theme.textSecondary};
	--text-muted: ${theme.textSecondary};
	--blue: ${theme.accent};
	--blue-dark: ${theme.accent};
	--link: ${theme.accent};
	--accent: ${theme.accent};
	--border: ${theme.border};
}

html.dark, body.dark {
	background-color: ${theme.background} !important;
	color: ${theme.textPrimary} !important;
}

body {
	background-color: transparent !important;
	color: ${theme.textPrimary} !important;
	margin: 0 !important;
	padding: 0 !important;
	font-size: 16px !important;
	line-height: 1.65 !important;
	word-break: break-word !important;
	width: 100% !important;
	max-width: 100% !important;
	overflow-x: hidden !important;
}

*, *::before, *::after {
	box-sizing: border-box !important;
}

p, li, td, th, span, small, label, ul, ol, pre, code, em {
	background-color: transparent !important;
	color: ${theme.textSecondary} !important;
	max-width: 100% !important;
}

h1, h2, h3, h4, h5, h6 {
	color: ${theme.textPrimary} !important;
	line-height: 1.25 !important;
	margin: 1.15em 0 0.55em 0 !important;
}

a, a * {
	color: ${theme.accent} !important;
}

a[href^="#"], a[href^="#"] * {
	color: #FFFFFF !important;
}

.rules-nav a, .rules-nav a * {
	pointer-events: none !important;
	cursor: default !important;
}

strong, b {
	color: ${theme.textPrimary} !important;
}

blockquote {
	color: ${theme.isDarkMode ? "#CBD5E1" : theme.textSecondary} !important;
	border-color: ${theme.border} !important;
}

table, thead, tbody, tfoot, tr, th, td {
	color: ${theme.textPrimary} !important;
	border-color: ${theme.border} !important;
	background-color: transparent !important;
}

table, th, td, blockquote, hr {
	border-color: ${theme.border} !important;
}

table {
	display: block !important;
	width: 100% !important;
	overflow-x: auto !important;
	border-collapse: collapse !important;
	margin: 1rem 0 !important;
}

th, td {
	padding: 10px 12px !important;
	vertical-align: top !important;
}

ul, ol {
	padding-left: 1.25rem !important;
	margin: 0.85rem 0 !important;
}

li {
	margin: 0.3rem 0 !important;
}

img, svg, video, iframe {
	display: block !important;
	width: auto !important;
	max-width: 100% !important;
	height: auto !important;
	object-fit: contain !important;
	margin-left: auto !important;
	margin-right: auto !important;
	background-color: transparent !important;
}

figure, picture, div {
	max-width: 100% !important;
	box-sizing: border-box !important;
}

figure {
	margin-left: 0 !important;
	margin-right: 0 !important;
}

section {
	width: 100% !important;
	max-width: 100% !important;
	padding: 18px 12px !important;
}

.rules-block {
	width: 100% !important;
	max-width: 100% !important;
	padding: 16px !important;
	margin: 0 0 16px 0 !important;
	border-radius: 14px !important;
}

.media-wrap {
	display: block !important;
	width: 100% !important;
	max-width: 100% !important;
	margin-top: 14px !important;
}

.media-copy {
	min-width: 0 !important;
	width: 100% !important;
}

.media-image, .center-image {
	width: 100% !important;
	max-width: 240px !important;
	margin: 16px auto !important;
	text-align: center !important;
}

.buoy-img, .center-image .buoy-img {
	display: block !important;
	width: 100% !important;
	max-width: 220px !important;
	height: auto !important;
	margin: 0 auto !important;
	object-fit: contain !important;
}

blockquote {
	padding: 0.75rem 1rem !important;
	border-left-width: 3px !important;
}

font {
	color: ${theme.textPrimary} !important;
}

* {
	text-shadow: none !important;
	box-shadow: none !important;
}
`;
}

function injectThemeCss(html: string, theme: HtmlThemeTokens): string {
  const style = `<style id="bergman-html-theme">${buildHtmlCss(theme)}</style>`;
  const cleaned = html.trim();
  const hasHtml = /<html\b[^>]*>/i.test(cleaned);
  const hasHead = /<head\b[^>]*>/i.test(cleaned);
  const darkClass = theme.isDarkMode ? "dark" : "";

  if (hasHtml) {
    const withThemeStyle = hasHead
      ? cleaned.replace(/<\/head>/i, `${style}</head>`)
      : cleaned.replace(
          /<html\b([^>]*)>/i,
          (_match, attrs: string) =>
            `<html${String(attrs ?? "")}><head>${style}</head>`,
        );
    return withThemeStyle.replace(
      /<html\b([^>]*)>/i,
      (_match, attrs: string) => {
        const current = String(attrs ?? "");
        if (/class\s*=\s*"([^"]*)"/i.test(current)) {
          return `<html${current.replace(
            /class\s*=\s*"([^"]*)"/i,
            (_classMatch, classValue: string) => {
              const classes = new Set(classValue.split(/\s+/).filter(Boolean));
              if (theme.isDarkMode) classes.add("dark");
              else classes.delete("dark");
              return `class="${Array.from(classes).join(" ")}"`;
            },
          )}>`;
        }
        return `<html${current}${darkClass ? ` class="${darkClass}"` : ""}>`;
      },
    );
  }

  return `<html${darkClass ? ` class="${darkClass}"` : ""}><head><meta name="viewport" content="width=device-width, initial-scale=1.0" />${style}</head><body>${cleaned}</body></html>`;
}

function injectAnchorNavigation(html: string): string {
  const script = `<script id="bergman-anchor-navigation">
(function () {
  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest ? event.target.closest('a') : null;
    if (!link) return;
    var href = link.getAttribute('href');
    if (!href) return;

    var hash = href.charAt(0) === '#' ? href : '';
    if (!hash) {
      try { hash = new URL(href, document.baseURI).hash || ''; } catch (error) {}
    }
    var targetId = hash ? decodeURIComponent(hash.substring(1)) : '';
    var target = targetId ? document.getElementById(targetId) : null;

    if (target) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (/^https?:\/\//i.test(href)) {
      event.preventDefault();
      var message = JSON.stringify({ type: 'external-link', url: href });
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(message);
      } else if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'bergman-external-link', url: href }, '*');
      }
    }
  }, true);
})();
</script>`;
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, `${script}</body>`)
    : `${html}${script}`;
}

function toText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function createHtmlThemeTokens(
  theme: ReturnType<typeof useTheme>,
  darkMode: boolean,
): HtmlThemeTokens {
  return {
    isDarkMode: darkMode,
    background: darkMode ? theme.colors.background : "#FFFFFF",
    surface: theme.colors.surface,
    card: theme.colors.surfaceElevated,
    soft: theme.colors.surface,
    textPrimary: theme.colors.textPrimary,
    textSecondary: theme.colors.textSecondary,
    accent: theme.colors.accent,
    border: theme.colors.border,
  };
}

export function normalizeEventHtml(
  html: string,
  theme: HtmlThemeTokens,
): string {
  return injectThemeCss(html, theme);
}

export function shouldUseWebView(html: string): boolean {
  const content = html.toLowerCase();
  return (
    /<!doctype\s+html/i.test(content) ||
    /<html\b/i.test(content) ||
    /<(?:iframe|script|style|link|video|audio|object|embed)\b/i.test(content)
  );
}

export function extractEventHtmlTitle(html: string): string | undefined {
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
  const title = toText(titleMatch?.[1]?.replace(/<[^>]+>/g, " "));
  if (title) return title;

  const headingMatch = html.match(/<(h[1-3])[^>]*>(.*?)<\/\1>/i);
  const heading = toText(headingMatch?.[2]?.replace(/<[^>]+>/g, " "));
  if (heading) return heading;

  return undefined;
}

function HtmlWebView({
  html,
  darkMode,
  fillContainer = false,
}: {
  html: string;
  darkMode: boolean;
  fillContainer?: boolean;
}) {
  const [height, setHeight] = useState(1);
  const webViewRef = useRef<NativeWebView>(null);
  const theme = useTheme();
  const htmlTheme = useMemo(
    () => createHtmlThemeTokens(theme, darkMode),
    [theme, darkMode],
  );
  const themedHtml = useMemo(
    () => injectAnchorNavigation(normalizeEventHtml(html, htmlTheme)),
    [html, htmlTheme],
  );
  const forceThemeScript = useMemo(() => {
    const background = JSON.stringify(htmlTheme.background);
    const textPrimary = JSON.stringify(htmlTheme.textPrimary);
    const textSecondary = JSON.stringify(htmlTheme.textSecondary);
    const border = JSON.stringify(htmlTheme.border);
    const accent = JSON.stringify(htmlTheme.accent);
    const isDark = htmlTheme.isDarkMode ? "true" : "false";
    return `
(function () {
	function applyTheme() {
		try {
			var root = document.documentElement;
			var body = document.body;
			if (!root) return;
			var dark = ${isDark};
			root.classList.toggle('dark', dark);
			if (body) body.classList.toggle('dark', dark);
			root.style.backgroundColor = ${background};
			root.style.color = ${textPrimary};
			root.style.setProperty('--bg', ${background});
			root.style.setProperty('--background', ${background});
			root.style.setProperty('--surface', dark ? '#111827' : ${JSON.stringify(theme.colors.surface)});
			root.style.setProperty('--card', dark ? ${JSON.stringify(theme.colors.surfaceElevated)} : ${JSON.stringify(theme.colors.surfaceElevated)});
			root.style.setProperty('--soft', ${JSON.stringify(theme.colors.surface)});
			root.style.setProperty('--text', ${textPrimary});
			root.style.setProperty('--text-color', ${textPrimary});
			root.style.setProperty('--foreground', ${textPrimary});
			root.style.setProperty('--muted', ${textSecondary});
			root.style.setProperty('--text-muted', ${textSecondary});
			root.style.setProperty('--blue', ${accent});
			root.style.setProperty('--blue-dark', ${accent});
			root.style.setProperty('--accent', ${accent});
			root.style.setProperty('--link', ${accent});
			root.style.setProperty('--border', ${border});
			if (body) {
				body.style.backgroundColor = ${background};
				body.style.color = ${textSecondary};
			}
		} catch (e) {}
	}
	applyTheme();
	window.addEventListener('load', function () {
		setTimeout(applyTheme, 0);
		setTimeout(applyTheme, 80);
		setTimeout(applyTheme, 300);
	});
	setTimeout(applyTheme, 0);
})();
true;
`;
  }, [htmlTheme, theme]);
  const injectedJavaScript = useMemo(
    () => `
(function () {
	var applyTheme = function () {
		try {
			var root = document.documentElement;
			var body = document.body;
			var dark = ${htmlTheme.isDarkMode ? "true" : "false"};
			if (root) {
				root.classList.toggle('dark', dark);
				root.style.backgroundColor = ${JSON.stringify(htmlTheme.background)};
				root.style.color = ${JSON.stringify(htmlTheme.textPrimary)};
			}
			if (body) {
				body.classList.toggle('dark', dark);
				body.style.backgroundColor = ${JSON.stringify(htmlTheme.background)};
				body.style.color = ${JSON.stringify(htmlTheme.textSecondary)};
			}
		} catch (e) {}
	};

	const postHeight = function () {
		var body = document.body;
		var html = document.documentElement;
		var height = Math.max(
			body ? body.scrollHeight : 0,
			body ? body.offsetHeight : 0,
			html ? html.clientHeight : 0,
			html ? html.scrollHeight : 0,
			html ? html.offsetHeight : 0
		);
		window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'height', height: height }));
	};

	window.addEventListener('load', function () {
		applyTheme();
		setTimeout(postHeight, 60);
		setTimeout(postHeight, 300);
		setTimeout(applyTheme, 0);
		setTimeout(applyTheme, 80);
		setTimeout(applyTheme, 300);
	});

	if (window.ResizeObserver && document.body) {
		try {
			var observer = new ResizeObserver(function () {
				postHeight();
			});
			observer.observe(document.body);
		} catch (error) {
			// ignore
		}
	}

	setTimeout(postHeight, 0);
	applyTheme();
})();
true;
`,
    [htmlTheme],
  );
  return (
    <NativeWebView
      ref={webViewRef}
      originWhitelist={["*"]}
      source={{ html: themedHtml, baseUrl: "https://bergmantri.com/" }}
      style={
        fillContainer
          ? {
              flex: 1,
              width: "100%",
              height: "100%",
              minHeight: 0,
              backgroundColor: theme.colors.background,
            }
          : { width: "100%", height, backgroundColor: theme.colors.background }
      }
      containerStyle={
        fillContainer
          ? {
              flex: 1,
              width: "100%",
              height: "100%",
              minHeight: 0,
              backgroundColor: theme.colors.background,
            }
          : { backgroundColor: theme.colors.background }
      }
      javaScriptEnabled
      domStorageEnabled
      scrollEnabled={fillContainer}
      nestedScrollEnabled
      setSupportMultipleWindows={false}
      injectedJavaScriptBeforeContentLoaded={forceThemeScript}
      onMessage={(event: { nativeEvent: { data?: string } }) => {
        try {
          const message = JSON.parse(String(event.nativeEvent.data));
          if (message?.type === "height" && Number.isFinite(message.height)) {
            setHeight(Math.max(1, Math.ceil(Number(message.height))));
            return;
          }
          if (
            message?.type === "external-link" &&
            typeof message.url === "string" &&
            /^https?:\/\//i.test(message.url)
          ) {
            void Linking.openURL(message.url);
          }
        } catch {
          // ignore malformed bridge messages
        }
      }}
      onShouldStartLoadWithRequest={(request) => {
        const url = request.url;
        const hashIndex = url.indexOf("#");
        if (hashIndex >= 0) {
          return false;
        }
        if (
          url === "about:blank" ||
          url === "https://bergmantri.com/" ||
          url.startsWith("data:text/html") ||
          url.startsWith("about:blank")
        ) {
          return true;
        }
        if (/^https?:\/\//i.test(url)) {
          void Linking.openURL(url);
          return false;
        }
        return true;
      }}
      injectedJavaScript={injectedJavaScript}
    />
  );
}

function HtmlIframe({ html, darkMode }: { html: string; darkMode: boolean }) {
  const theme = useTheme();
  const htmlTheme = useMemo(
    () => createHtmlThemeTokens(theme, darkMode),
    [theme, darkMode],
  );
  const preparedHtml = useMemo(
    () => injectAnchorNavigation(normalizeEventHtml(html, htmlTheme)),
    [html, htmlTheme],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | undefined;
      if (
        data?.type === "bergman-external-link" &&
        typeof data.url === "string" &&
        /^https?:\/\//i.test(data.url)
      ) {
        void Linking.openURL(data.url);
      }
    };
    globalThis.addEventListener?.("message", onMessage as EventListener);
    return () =>
      globalThis.removeEventListener?.("message", onMessage as EventListener);
  }, []);

  return createElement("iframe", {
    srcDoc: preparedHtml,
    title: "Event rules",
    style: {
      width: "100%",
      height: "100%",
      border: 0,
      backgroundColor: htmlTheme.background,
    },
  });
}

function HtmlRenderHtml({
  html,
  darkMode,
  availableWidth,
}: {
  html: string;
  darkMode: boolean;
  availableWidth?: number;
}) {
  const { width } = useWindowDimensions();
  const theme = useTheme();
  const contentWidth = Math.max(
    0,
    availableWidth ?? width - theme.spacing.base * 2,
  );
  const imageWidth = Math.min(contentWidth, 220);
  const htmlTheme = useMemo(
    () => createHtmlThemeTokens(theme, darkMode),
    [theme, darkMode],
  );
  const themedHtml = useMemo(
    () => normalizeEventHtml(html, htmlTheme),
    [html, htmlTheme],
  );
  const bodyColor = htmlTheme.isDarkMode ? "#E5E7EB" : theme.colors.textPrimary;
  const headingColor = htmlTheme.isDarkMode
    ? "#FFFFFF"
    : theme.colors.textPrimary;
  const linkColor = htmlTheme.isDarkMode ? "#60A5FA" : theme.colors.accent;
  const borderColor = htmlTheme.border;

  return (
    <RenderHTML
      contentWidth={contentWidth}
      source={{ html: themedHtml, baseUrl: "https://bergman.local/" }}
      baseStyle={{
        color: bodyColor,
        fontSize: 16,
        lineHeight: 25,
        backgroundColor: "transparent",
      }}
      tagsStyles={{
        body: { color: bodyColor, backgroundColor: "transparent" },
        h1: { color: headingColor, marginBottom: 12 },
        h2: { color: headingColor, marginBottom: 10 },
        h3: { color: headingColor, marginBottom: 8 },
        h4: { color: headingColor, marginBottom: 8 },
        h5: { color: headingColor, marginBottom: 6 },
        h6: { color: headingColor, marginBottom: 6 },
        p: { color: bodyColor, marginTop: 0, marginBottom: 12 },
        li: { color: bodyColor, marginBottom: 6 },
        span: { color: bodyColor },
        strong: { color: headingColor },
        b: { color: headingColor },
        blockquote: {
          color: htmlTheme.isDarkMode ? "#CBD5E1" : theme.colors.textSecondary,
          marginVertical: 12,
        },
        table: { color: headingColor },
        th: { color: headingColor, borderColor, borderWidth: 1 },
        td: { color: headingColor, borderColor, borderWidth: 1 },
        a: { color: linkColor },
        img: { maxWidth: imageWidth, width: imageWidth, alignSelf: "center" },
      }}
      computeEmbeddedMaxWidth={(_availableWidth, tagName) =>
        tagName === "img" ? imageWidth : contentWidth
      }
      renderersProps={{
        a: {
          onPress: (_event: unknown, href?: string) => {
            if (href?.startsWith("#")) return;
            if (href && /^https?:\/\//i.test(href)) {
              void Linking.openURL(href);
            }
          },
        },
        img: { enableExperimentalPercentWidth: true },
      }}
    />
  );
}

export function EventHtmlContent({
  html,
  forceColorScheme,
  availableWidth,
  fillContainer = false,
}: {
  html: string;
  forceColorScheme?: "light" | "dark";
  availableWidth?: number;
  fillContainer?: boolean;
}) {
  const resolvedDarkMode = useResolvedColorScheme() === "dark";
  const darkMode = forceColorScheme
    ? forceColorScheme === "dark"
    : resolvedDarkMode;
  const useDocumentFrame = shouldUseWebView(html);

  return useDocumentFrame && Platform.OS === "web" ? (
    <HtmlIframe html={html} darkMode={darkMode} />
  ) : useDocumentFrame ? (
    <HtmlWebView
      html={html}
      darkMode={darkMode}
      fillContainer={fillContainer}
    />
  ) : (
    <HtmlRenderHtml
      html={html}
      darkMode={darkMode}
      availableWidth={availableWidth}
    />
  );
}

export function EventHtmlBlockCard({
  block,
  index,
}: {
  block: EventHtmlBlock;
  index: number;
}) {
  const theme = useTheme();
  const html = block.html?.trim();
  if (!html) return null;

  const title =
    extractEventHtmlTitle(html) ?? toText(block.id) ?? `Section ${index + 1}`;

  return (
    <Card style={{ gap: theme.spacing.md }}>
      <View style={{ gap: theme.spacing.xs }}>
        <Text variant="headline">{title}</Text>
      </View>
      <EventHtmlContent html={html} />
    </Card>
  );
}

export function EventHtmlBlockList({ blocks }: { blocks: EventHtmlBlock[] }) {
  const theme = useTheme();
  const validBlocks = blocks.filter((block) => Boolean(block.html?.trim()));
  if (validBlocks.length === 0) return null;

  return (
    <View style={{ gap: theme.spacing.md }}>
      {validBlocks.map((block, index) => (
        <EventHtmlBlockCard
          key={block.id ?? String(index)}
          block={block}
          index={index}
        />
      ))}
    </View>
  );
}
