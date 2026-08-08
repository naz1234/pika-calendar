import type { Metadata, Viewport } from "next";
import "./globals.css";

const metadataBase = new URL(
  process.env.CF_PAGES_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
);

export const metadata: Metadata = {
  metadataBase,
  title: "My Calendar",
  description: "A private, mobile-first Work and Personal calendar with week numbers.",
  applicationName: "My Calendar",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/calendar-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/calendar-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: "/icons/calendar-192.png",
  },
  openGraph: {
    title: "My Calendar",
    description: "Work + Personal. One calm place.",
    type: "website",
    url: "/",
    siteName: "My Calendar",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "My Calendar month view" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "My Calendar",
    description: "Work + Personal. One calm place.",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0e13",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
