import { z } from 'zod';

// A CHT instance users can sign in to. Only instances from configuration are ever contacted, so the
// server can't be pointed at an arbitrary host.
export type Instance = {
  id: string;
  name: string;
  // host[:port], no scheme or path
  host: string;
  useHttp: boolean;
  // identity-provider origins allowed to receive an SSO access token; empty disables SSO
  idpOrigins: string[];
};

const origin = z
  .string()
  .url()
  .refine((value) => new URL(value).origin === value.replace(/\/$/, ''), 'must be an origin, without a path');

const instanceSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes'),
    name: z.string().min(1),
    host: z.string().regex(/^[A-Za-z0-9.-]+(:\d{1,5})?$/, 'host[:port], without a scheme or path'),
    useHttp: z.boolean().default(false),
    idpOrigins: z.array(origin).default([])
  })
  .strict();

export const instancesFileSchema = z
  .object({ instances: z.array(instanceSchema) })
  .strict()
  .refine((file) => new Set(file.instances.map((i) => i.id)).size === file.instances.length, 'instance ids must be unique');

export function baseUrl(instance: Instance): string {
  return `${instance.useHttp ? 'http' : 'https'}://${instance.host}/`;
}

export function findInstance(instances: Instance[], id: string): Instance | undefined {
  return instances.find((instance) => instance.id === id);
}
