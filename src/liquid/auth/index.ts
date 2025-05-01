import { AuthenticationInfo } from '../../config';

export type AuthFormViewModel = {
  domains: AuthenticationInfo[];
  error?: string;
};

export type AuthViewModel = {
  logo: string;
} & AuthFormViewModel;
