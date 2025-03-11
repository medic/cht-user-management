/**
 * Type definitions for Superset API payloads
 */

/**
 * Payload for creating a user in Superset
 */
export interface SupersetUserPayload {
  active: boolean;
  first_name: string;
  last_name: string;
  email: string;
  username: string;
  password: string;
  roles: string[];
}

/**
 * Superset role definition
 * Format: PREFIX_NAME (e.g., "CHA_ROLE_NAME")
 */
export interface SupersetRole {
  name: string;
}

/**
 * Superset row-level security rule
 */
export interface SupersetRls {
  clause: string;
  filter_type: 'Regular' | 'Base';
  group_key: string;
  name: string;
  roles: string[];
  tables: string[];
}

/**
 * Table information from Superset API
 */
export interface SupersetTable {
  id: string;
  name: string;
  schema: string;
}
