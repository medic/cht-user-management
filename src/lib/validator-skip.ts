import { IValidator } from './validation';

export default class ValidatorSkip implements IValidator {
  isValid(input: string) : boolean | string {
    return true;
  }

  format(input : string) : string {
    return input;
  }

  get defaultError(): string {
    throw 'never';
  }
};
