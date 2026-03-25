import { IValidator } from '.';

export default class ValidatorString implements IValidator {
  isValid(input: string) : boolean | string {
    return !!input;
  }

  format(input : string) : string {
    input = input.replace(/[^^\p{L}\p{N}\p{M} ()@./\-_']/gu, '');
    input = input.replace(/\s\s+/g, ' ');
    return input.trim();
  }

  get defaultError(): string {
    return 'Is Required';
  }
}
