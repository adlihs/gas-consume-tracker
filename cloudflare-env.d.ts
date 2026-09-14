declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    APP_ORIGIN?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    ALLOW_HTTP_LOCALHOST?: string;
    BUCKET?: R2Bucket;
  }
}
