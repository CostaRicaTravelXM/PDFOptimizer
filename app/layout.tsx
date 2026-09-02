import type { Metadata, Viewport } from 'next';
import { Caveat, Cormorant_Garamond, DM_Sans, Playfair_Display } from 'next/font/google';
import './globals.css';

/**
 * Keep extension-injected attributes out of the DOM while React hydrates.
 *
 * Bitdefender Anti-tracker (extension id eppiocemhmnlbhjplcgkofciie) stamps
 * `bis_skin_checked` / `bis_register` onto elements as the page parses, and Grammarly and
 * several password managers do the equivalent. React compares the server HTML against what
 * it renders and reports the extras as a mismatch it "won't patch up". Marking <html> and
 * <body> with suppressHydrationWarning handles those two elements, but the attributes also
 * land on ordinary <div>s — including one Next.js renders for metadata — where that opt-out
 * cannot reach.
 *
 * So strip them, but only until hydration is finished. The attributes are the extension's
 * "already processed" markers; removing them permanently would make it redo its work on
 * every mutation, which is not our call to make. The observer disconnects on load.
 */
const STRIP_EXTENSION_ATTRIBUTES = `(function(){
  var NAMES = ['bis_skin_checked','bis_register','bis_id'];
  var strip = function(el){
    if (!el || el.nodeType !== 1) return;
    for (var i = 0; i < NAMES.length; i++) {
      if (el.hasAttribute(NAMES[i])) el.removeAttribute(NAMES[i]);
    }
    var attrs = el.attributes;
    for (var j = attrs.length - 1; j >= 0; j--) {
      if (attrs[j].name.indexOf('__processed_') === 0) el.removeAttribute(attrs[j].name);
    }
  };
  var observer = new MutationObserver(function(records){
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      if (r.type === 'attributes') strip(r.target);
      else for (var j = 0; j < r.addedNodes.length; j++) strip(r.addedNodes[j]);
    }
  });
  observer.observe(document, { childList: true, subtree: true, attributes: true });
  var stop = function(){
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){ observer.disconnect(); });
    });
  };
  if (document.readyState === 'complete') stop();
  else window.addEventListener('load', stop);
})();`;

// The same four families travelxm.com loads.
const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
});
const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-cormorant',
  display: 'swap',
});
const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
});
const caveat = Caveat({
  subsets: ['latin'],
  variable: '--font-caveat',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'PDF Optimizer — TravelXM',
  description:
    'Shrink oversized PDFs so they can be emailed, without losing quality. Files never leave your computer.',
  icons: { icon: '/logotxm.png' },
};

export const viewport: Viewport = {
  themeColor: '#d9ecf5',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning covers <html> and <body>; the script above covers everything
    // below them. Both are about browser extensions — this markup is entirely static.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${dmSans.variable} ${cormorant.variable} ${playfair.variable} ${caveat.variable}`}
    >
      <head>
        {/*
          A raw inline tag, not next/script. `beforeInteractive` pushes the source into
          Next's own bootstrap queue (`self.__next_s`), which runs too late to matter here —
          the observer has to be installed while <head> is still parsing, before the body's
          elements exist for an extension to stamp.
        */}
        <script dangerouslySetInnerHTML={{ __html: STRIP_EXTENSION_ATTRIBUTES }} />
      </head>
      <body suppressHydrationWarning className="font-sans text-fg antialiased">
        {children}
      </body>
    </html>
  );
}
