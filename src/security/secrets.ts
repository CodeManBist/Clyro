const protectedExtensions = new Set([
    ".pem",
    ".key",
    ".p12",
  ]);
  
  const protectedNames = new Set([
    ".npmrc",
    ".netrc",
    ".git-credentials",
  ]);
  
  const protectedDirectories = new Set([
    ".git",
    ".aws",
    ".ssh",
  ]);
  
  export function isSecretPath(relativePath: string): boolean {
    const normalizedPath = relativePath
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .toLowerCase();
  
    const segments = normalizedPath
      .split("/")
      .filter(Boolean);
  
    const fileName = segments.at(-1) ?? "";
  
    // Protect sensitive directories at any depth.
    if (segments.some((segment) =>
      protectedDirectories.has(segment)
    )) {
      return true;
    }
  
    // Allow safe environment examples.
    if (fileName === ".env.example" || fileName === ".env.sample") {
      return false;
    }
  
    // Protect environment files.
    if (fileName === ".env" || fileName.startsWith(".env.")) {
      return true;
    }
  
    // Protect known credential filenames.
    if (protectedNames.has(fileName)) {
      return true;
    }
  
    if (
      fileName.startsWith("id_rsa") ||
      fileName.startsWith("id_ed25519") ||
      fileName.startsWith("credentials")
    ) {
      return true;
    }
  
    // Protect private-key file extensions.
    const extension = fileName.includes(".")
      ? `.${fileName.split(".").pop()}`
      : "";
  
    return protectedExtensions.has(extension);
  }
