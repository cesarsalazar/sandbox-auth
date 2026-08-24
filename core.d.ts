import type { SandboxConfig, SandboxMember } from "./index";
export function resolveConfig(o?: SandboxConfig): Required<SandboxConfig> & { txCookie: string };
export function cookieName(cfg: unknown, secure: boolean): string;
export function readSession(cfg: unknown, token?: string): Promise<SandboxMember | null>;
export function completeSignIn(a: { cfg: unknown; query: Record<string,string>; cookies: Record<string,string>; redirectUri: string }): Promise<{ member?: SandboxMember; token?: string; next?: string; error?: string }>;
export function endSessionUrl(cfg: unknown, postLogout?: string): string;
