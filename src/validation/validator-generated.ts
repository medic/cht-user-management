import { Liquid } from 'liquidjs';
import { IValidator } from '.';
import { ContactProperty } from '../config';
import Place from '../services/place';

const engine = new Liquid({
  strictVariables: false,
});

type GeneratorScope = {
  place: any;
  contact: any;
  lineage: any;
};

export default class ValidatorGenerated implements IValidator {
  isValid(input: string, property : ContactProperty) : boolean | string {
    const parameter = this.getParameter(property);
    return engine.parse(parameter)?.length > 0;
  }

  format(input : any, property : ContactProperty) : string {
    if (!(input instanceof Place)) {
      throw Error('invalid program. ValidatorGenerated should be passed a Place');
    }

    const place:Place = input;
    const generationScope: GeneratorScope = {
      place: place.properties,
      contact: place.contact.properties,
      lineage: place.hierarchyProperties,
    };

    const parameter = this.getParameter(property);
    return engine.parseAndRenderSync(parameter, generationScope);
  }

  get defaultError(): string {
    return `Template cannot be genereated`;
  }

  private getParameter(property: ContactProperty) {
    const parameter = property.parameter;
    if (typeof parameter !== 'string') {
      throw Error(`Attribute "parameter" on '${property.property_name}' has type 'generated'. Expects string (eg. "{{ contact.name }} Area").`);
    }
    return parameter;
  }
}
