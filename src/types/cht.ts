export interface UserCreationDetails {
  username: string;
  password: string;
  email: string;
  name: string;
  supersetUserId?: number;
  supersetRoles?: number[];
}
