/**
 * Bundled font assets.
 *
 * Metro resolves a `.ttf` import to an opaque asset id; this tells TypeScript
 * what that import is, so `design/fonts.ts` can load them by name without a
 * `require` and without an `any`.
 */
declare module '*.ttf' {
  const asset: number
  export default asset
}
