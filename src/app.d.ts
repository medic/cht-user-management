// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Authenticated } from '$lib/server/auth/session';

declare global {
  namespace App {
    interface Locals {
      auth?: Authenticated;
    }
  }
}

export {};
