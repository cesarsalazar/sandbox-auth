export interface SandboxMember {
  sub: string; name?: string; email?: string; picture?: string; phone_number?: string;
  /** Only for an app a member built: the profile fields the member agreed to share, by key. */
  member_data?: Record<string, unknown>;
  iat?: number;
}
export interface SandboxConfig {
  clientId?: string; sessionSecret?: string; authOrigin?: string;
  cookieName?: string; sessionTtl?: number; callbackPath?: string; bypass?: string;
  retryPath?: string;
}
