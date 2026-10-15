// next.config.ts inlines *.html files as their exact bytes (turbopack module type "bytes").
declare module "*.html" {
  const bytes: Uint8Array<ArrayBuffer>;
  export default bytes;
}
