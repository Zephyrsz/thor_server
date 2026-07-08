import "./globals.css";

export const metadata = {
  title: "Realtime Voice Console",
  description: "A Next.js UI for the speech-to-speech realtime websocket server.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
