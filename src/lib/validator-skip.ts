import { IValidator } from './validation';

export default class ValidatorSkip implements IValidator {
  isValid(input: string) : boolean {
    return true;
  }

  format(input : string) : string {
    return input;
  }
};
