import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SMCraft Designer",
  description: "Visual State Machine Designer",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
