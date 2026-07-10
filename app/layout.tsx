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
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
        <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'%3E%3Crect width='80' height='80' rx='16' fill='%23E8772C'/%3E%3Crect x='10' y='52' width='10' height='20' rx='2' fill='rgba(255,255,255,0.45)'/%3E%3Crect x='24' y='42' width='10' height='30' rx='2' fill='rgba(255,255,255,0.62)'/%3E%3Crect x='38' y='30' width='10' height='42' rx='2' fill='rgba(255,255,255,0.80)'/%3E%3Crect x='52' y='16' width='10' height='56' rx='2' fill='white'/%3E%3Cpolyline points='15,50 29,40 43,28 57,14' fill='none' stroke='rgba(255,255,255,0.95)' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3Ccircle cx='57' cy='14' r='3.5' fill='white'/%3E%3C/svg%3E" />
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
