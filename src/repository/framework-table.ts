export const FRAMEWORK_TABLE: Record<string, string> = {
    react: "react",
    next: "next",
    vue: "vue",
    "@angular/core": "angular",
    svelte: "svelte",
  
    express: "express",
    fastify: "fastify",
    "@nestjs/core": "nestjs",
    koa: "koa",
    hono: "hono",
  };
  
  export function detectFrameworks(
    dependencies: Record<string, string> = {},
    devDependencies: Record<string, string> = {},
  ): string[] {
    const installedPackages = new Set([
      ...Object.keys(dependencies),
      ...Object.keys(devDependencies),
    ]);
  
    return Object.keys(FRAMEWORK_TABLE)
      .filter((packageName) => installedPackages.has(packageName))
      .map((packageName) => FRAMEWORK_TABLE[packageName]!)
      .sort();
  }