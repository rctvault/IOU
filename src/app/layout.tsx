import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "IOU — shared cost tracker",
  description:
    "Track shared expenses across currencies, split bills with tax and discounts, and settle up.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "IOU", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
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
