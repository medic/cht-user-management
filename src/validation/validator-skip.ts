import { IValidator } from '.';

export default class ValidatorSkip implements IValidator {
  isValid(): boolean {
    return true;
  }

  format(input : string) : string {
    return input;
  }

  defaultError(): string {
    throw 'never';
  }
}
