import _ from 'lodash';
import { ContactProperty } from '../config';
import { IValidator } from './validation';

export default class ValidatorRole implements IValidator {
  isValid(input: string, property: ContactProperty): boolean | string {
    const allowedRoles = property.parameter as string[];
    
    // Check if user roles are specified and not empty
    const selectedRoles = input.split(' ').map((role: string) => role.trim()).filter(Boolean);
    if (!selectedRoles.length) {
      return `Should provide at least one role`;
    }

    // Check if all provided roles are allowed
    const invalidRoles = _.difference(selectedRoles, allowedRoles);
    if (invalidRoles.length === 1) {
      return `Role '${invalidRoles[0]}' is not allowed`;
    } else if (invalidRoles.length > 1) {
      return `Roles '${invalidRoles.join(', ')}' are not allowed`;
    }
    
    return true;
  }

  format(input: string): string {
    return input; 
  }

  get defaultError(): string {
    return 'Invalid user roles';
  }
}
