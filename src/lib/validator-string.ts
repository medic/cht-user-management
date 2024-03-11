import { IValidator } from './validation';

export default class ValidatorString implements IValidator {
  isValid(input: string) : boolean | string {
    return !!input;
  }

  format(input : string) : string {
    input = input.replace(/[^a-zA-Z0-9 ()@./\-'éôîêàèùçœ]/gu, '');
    input = input.replace(/\s\s+/g, ' ');
    return input.trim();
  }

  get defaultError(): string {
    return 'Is Required';
  }
}
