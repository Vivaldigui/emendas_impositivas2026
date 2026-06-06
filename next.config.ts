import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  // playwright é uma dependência nativa (binários de browser). Mantê-la fora
  // do bundle do Next evita que rotas que dependem do collector quebrem na
  // inicialização serverless. O import dela já é lazy no collector.
  serverExternalPackages: ["playwright"],
};

export default nextConfig;
