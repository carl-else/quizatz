/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENTRA_CLIENT_ID?: string;
  readonly VITE_ENTRA_TENANT_ID?: string;
  readonly VITE_ENTRA_API_SCOPE?: string;
  readonly VITE_PARTYKIT_HOST?: string;
  readonly VITE_PARTYKIT_PROTOCOL?: "ws" | "wss";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
