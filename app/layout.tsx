import "./globals.css";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider } from "@/lib/auth";

export const metadata = {
  title: "AI Accuracy Database",
  description: "Internal AI accuracy monitoring across projects",
};

const noFlashScript = `
(function() {
  try {
    var mode = localStorage.getItem('accuracy-monitor-mode') || 'system';
    var accent = localStorage.getItem('accuracy-monitor-accent') || 'orange';
    if (mode !== 'system') document.documentElement.setAttribute('data-mode', mode);
    document.documentElement.setAttribute('data-accent', accent);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/tabler-icons/2.47.0/iconfont/tabler-icons.min.css" />
        <script dangerouslySetInnerHTML={{ __html: noFlashScript }} />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
