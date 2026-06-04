import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  {
    ignores: ["generated/prisma/**", "src/generated/prisma/**"],
  },
  ...nextVitals,
];

export default eslintConfig;
