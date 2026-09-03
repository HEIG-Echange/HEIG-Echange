/* Configuration Tailwind (CDN), partagee par toutes les pages.
   A charger juste apres <script src="https://cdn.tailwindcss.com"></script> :
   le CDN lit `tailwind.config` au moment ou il genere les classes.
   Les memes couleurs sont declarees en variables CSS dans css/app.css, pour
   les regles qui ne passent pas par Tailwind. */
/* global tailwind */
tailwind.config = {
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#c8102e", dark: "#a30d25", light: "#f9e4e7" },
        appbg: "#f5f4f0",
        appfg: "#1a1816",
        secondarybg: "#f0ede8",
        mutedbg: "#e8e5e0",
        mutedfg: "#7a7670",
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', "-apple-system", "sans-serif"],
      },
      screens: {
        // Palier supplementaire : au-dela, la grille passe a 4 colonnes.
        "3xl": "1440px",
      },
    },
  },
};
