import { expect } from "chai";

import Place from "../../src/services/place";
import { mockSimpleContactType } from "../mocks";

describe('service place.ts', () => {
  it('setPropertiesFromFormData', () => {
    const contactType = mockSimpleContactType('string', undefined);
    contactType.contact_properties = contactType.place_properties;
    const place = new Place(contactType);
    place.properties.existing = 'existing';
    
    const formData = {
      place_prop: 'abc',
      contact_prop: 'efg',
      garbage: 'ghj',
    };
    place.setPropertiesFromFormData(formData);
    
    expect(place.properties).to.deep.eq({
      existing: 'existing',
      prop: 'abc',
    });
    expect(place.contact.properties).to.deep.eq({
      prop: 'efg',
    });
  });

  it('asFormData', () => {
    const contactType = mockSimpleContactType('string', undefined);
    contactType.contact_properties = contactType.place_properties;
    const place = new Place(contactType);
    place.properties.existing = 'existing';
    place.properties.prop = 'abc';
    place.contact.properties.prop = 'efg';
    const actual = place.asFormData();
    
    expect(actual).to.deep.eq({
      place_existing: 'existing',
      place_prop: 'abc',
      contact_prop: 'efg',
    });
  });
});
