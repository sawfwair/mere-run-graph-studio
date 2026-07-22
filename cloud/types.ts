export interface Env {
  STUDIO_ACCOUNTS: DurableObjectNamespace;
  ASSETS: Fetcher;
  BROKER_ORIGIN: string;
  RELAY_ORIGIN: string;
  STUDIO_ORIGIN: string;
}

export interface Identity {
  user_id: string;
  email?: string;
  name?: string;
}

export interface TokenResponse {
  access_token?: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}
