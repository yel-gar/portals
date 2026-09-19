/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend origin (no trailing slash), e.g. `http://localhost:8000`. */
  readonly VITE_BACKEND_URL?: string;
  /** Set by compose from `DISABLE_REGISTRATION`; gates the Register page. */
  readonly VITE_DISABLE_REGISTRATION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
