import { IValidator } from './validation';

export default class ValidatorGender implements IValidator {
  isValid(input: string) : boolean | string {
    const isValid = this.parseGenders(input).isValid;
    return isValid;
  }

  format(input : string) : string {
    const { isValid, gender } = this.parseGenders(input);
    if (isValid) {
      return gender;
    }

    return input;
  }

  get defaultError(): string {
    return `Must be either 'Male' or 'Female'`;
  }

  private parseGenders(input: string): { gender: string, isValid: boolean } {
    const isFemale = input?.match(/[fw]/i);
    const isMale = input?.match(/m(?<!fem|wom)/i);
    const isValid = (!!isFemale || !!isMale) && !(isFemale && isMale);
    const gender = isMale ? 'Male' : 'Female';
    return { isValid, gender };
  }
};
