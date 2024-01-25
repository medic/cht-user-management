import { IValidator } from './validation';

export default class ValidatorSkip implements IValidator {
  isValid() : boolean | string {
    return true;
  }

  format(input : string) : string {
    return input;
  }

  get defaultError(): string {
    throw 'never';
  }
}
