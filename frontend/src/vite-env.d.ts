/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend origin (no trailing slash), e.g. `http://localhost:8000`. */
  readonly VITE_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
