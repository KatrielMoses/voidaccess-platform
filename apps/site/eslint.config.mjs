import next from "eslint-config-next";

const config = [
  ...next,
  { ignores: [".next/**", ".open-next/**", "node_modules/**", "next-env.d.ts", "playwright-report/**", "test-results/**", ".wrangler/**"] },
];
export default config;
