import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tallio — shared cost tracker",
  description:
    "Track shared expenses across currencies, split bills with tax and discounts, and settle up.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Tallio", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#11363e",
  width: "device-width",
  initialScale: 1,
  // No maximumScale — let users pinch-zoom for accessibility. (16px inputs
  // already prevent the annoying focus auto-zoom.)
  // Let content extend under the notch/home indicator so we can pad with
  // env(safe-area-inset-*) ourselves.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full">
        <div className="mx-auto min-h-full w-full max-w-md bg-background">
          {children}
        </div>
      </body>
    </html>
  );
}
