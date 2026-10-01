/**
 * Stylesheet imports.
 *
 * `App.tsx` imports `./global.css` purely for its side effect (NativeWind reads
 * it at build time); TypeScript 6 refuses a side-effect import it cannot type,
 * so the extension needs declaring.
 */
declare module '*.css'
