export interface SandboxMember { sub: string; name?: string; email?: string; iat?: number }
export interface SandboxConfig {
  clientId?: string; sessionSecret?: string; authOrigin?: string;
  cookieName?: string; sessionTtl?: number; callbackPath?: string; bypass?: string;
  retryPath?: string;
}
