import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ruta · Control de gasolina",
  description: "Registra tus cargas y estima hasta dónde te llevan.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
