import { Playfair_Display, Inter } from 'next/font/google';
import './globals.css';

// next/font self-hosts these into the static export at build time, so the
// widget never reaches for Google Fonts at runtime — it works offline.
const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-playfair',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata = {
  title: 'GhostNote',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${playfair.variable} ${inter.variable}`}>
      <body data-edge="right" data-collapsed="false" className="font-sans">
        {children}
      </body>
    </html>
  );
}
