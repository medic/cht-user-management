import { IValidator } from './validation';

export default class ValidatorString implements IValidator {
  isValid(input: string) : boolean {
    return !!input;
  }

  format(input : string) : string {
    input = input.replace(/[^a-zA-Z0-9 ()\-']/g, '');
    input = input.replace(/\s\s+/g, ' ');
    return input.trim();
  }
};
