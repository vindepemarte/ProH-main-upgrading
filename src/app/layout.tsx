import type {Metadata, Viewport} from 'next';
import './globals.css';
import { AppProvider } from '@/contexts/app-context';
import { QueryProvider } from '@/components/providers/query-provider';
import { Toaster } from "@/components/ui/toaster";
import BottomNavbar from '@/components/layout/bottom-navbar';

export const metadata: Metadata = {
  title: 'ProHappyAssignments',
  description: 'Streamline Your Success with ProHappyAssignments',
  keywords: ['assignments', 'homework', 'education', 'productivity'],
  authors: [{ name: 'ProHappyAssignments Team' }],
  creator: 'ProHappyAssignments',
  publisher: 'ProHappyAssignments',
  applicationName: 'ProHappyA',
  generator: 'Next.js',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
    apple: '/icon-192.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#008080',
  colorScheme: 'light',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Generate cache busting timestamp
  const cacheVersion = process.env.NODE_ENV === 'production' ? Date.now() : 'dev';
  
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#008080" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="ProHappyA" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&display=swap" rel="stylesheet" />
        {/* Cache busting meta tags */}
        <meta name="cache-version" content={`v${cacheVersion}`} />
        <meta httpEquiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
        <meta httpEquiv="Pragma" content="no-cache" />
        <meta httpEquiv="Expires" content="0" />
      </head>
      <body className="font-body antialiased">
        <QueryProvider>
          <AppProvider>
            {children}
            <BottomNavbar />
            <Toaster />
          </AppProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
