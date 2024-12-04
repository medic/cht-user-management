import { ContactProperty } from '../config';
import { Validation } from './validation';

export type ValidationError = {
  property_name: string;
  description: string;
};

export interface IValidator {
  isValid(input: string, property? : ContactProperty) : boolean | string;
  format(input : string, property? : ContactProperty) : string;
  get defaultError(): string;
}

export default Validation;
