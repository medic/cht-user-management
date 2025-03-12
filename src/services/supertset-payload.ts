export type SupersetUserPayload = {
  active: boolean;
  first_name: string;
  last_name: string;
  email: string;
  username: string;
  password: string;
  roles: string[];
};

export type SupersetRole = {
  name: string;
};

export type SupersetRls = {
  clause: string;
  filter_type: string;
  group_key: string;
  name: string;
  roles: string[];
  tables: string[];
};
