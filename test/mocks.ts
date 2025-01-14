import { expect } from 'chai';
import sinon from 'sinon';

import { ChtApi } from '../src/lib/cht-api';
import ChtSession from '../src/lib/cht-session';
import { Config, ContactProperty, ContactType } from '../src/config';
import Place from '../src/services/place';
import PlaceFactory from '../src/services/place-factory';
import { UnvalidatedPropertyValue } from '../src/property-value';

export type ChtDoc = {
  _id: string;
  name: string;
  [key: string]: string | Object;
};

export const mockPlace = (contactType: ContactType, formDataOverride?: any) : Place => {
  const formData = Object.assign({
    place_name: 'name',
    place_prop: 'prop',
    hierarchy_PARENT: 'parent',
    contact_name: 'contact'
  }, formDataOverride);
  const place = new Place(contactType);
  place.setPropertiesFromFormData(formData, 'hierarchy_');
  place.resolvedHierarchy[1] = {
    id: 'known',
    name: new UnvalidatedPropertyValue('parent'),
    lineage: [],
    type: 'remote',
  };
  place.validate();
  return place;
};

export const mockChtApi = (first: ChtDoc[] = [], second: ChtDoc[] = [], third: ChtDoc[] = [], fourth: ChtDoc[] = []): any => ({
  chtSession: mockChtSession(),
  getPlacesWithType: sinon.stub()
    .onFirstCall().resolves(first)
    .onSecondCall().resolves(second)
    .onThirdCall().resolves(third)
    .onCall(3).resolves(fourth),
  createPlace: sinon.stub().resolves({ placeId: 'created-place-id', contactId: 'created-contact-id' }),
  createUser: sinon.stub().resolves(),
  getParentAndSibling: sinon.stub().resolves({
    parent: {
      link_facility_code: '12345',
      link_facility_name: 'facility',
      name: 'chu',
      code: '123456',
    },
    sibling: undefined,
  }),
});

export const mockSimpleContactType = (
  propertyType: string,
  propertyValidator?: string | string[] | object,
  errorDescription?: string
) : ContactType => {
  const mockedProperty = mockProperty(propertyType, propertyValidator);
  mockedProperty.errorDescription = errorDescription;
  return {
    name: 'contacttype-name',
    friendly: 'friendly',
    contact_type: 'contact-type',
    user_role: ['role'],
    username_from_place: false,
    deactivate_users_on_replace: false,
    hierarchy: [
      {
        ...mockProperty('name', undefined, 'PARENT'),
        level: 1,
        contact_type: 'parent',
      },
    ],
    replacement_property: mockProperty('name', undefined, 'replacement'),
    place_properties: [
      mockProperty('name', undefined, 'name'),
      mockedProperty,
    ],
    contact_properties: [
      mockProperty('name', undefined, 'name'),
    ],
  };
};

export async function createChu(subcounty: ChtDoc, chu_name: string, sessionCache: any, chtApi: ChtApi, dataOverrides?: any): Promise<Place> {
  const chuType = await Config.getContactType('c_community_health_unit');
  const chuData = Object.assign({
    hierarchy_SUBCOUNTY: subcounty.name,
    place_name: chu_name,
    place_code: '676767',
    place_link_facility_name: 'facility name',
    place_link_facility_code: '23456',
    contact_name: 'new cha',
    contact_phone: '0712345678',
  }, dataOverrides);
  const chu = await PlaceFactory.createOne(chuData, chuType, sessionCache, chtApi);
  if (!dataOverrides) {
    expect(chu.validationErrors).to.be.empty;
  }
  return chu;
}

export const mockValidContactType = (propertyType: string, propertyValidator: string | string[] | undefined) : ContactType => ({
  name: 'contacttype-name',
  friendly: 'friendly',
  contact_type: 'contact-type',
  user_role: ['role'],
  username_from_place: false,
  deactivate_users_on_replace: false,
  hierarchy: [
    {
      ...mockProperty('name', undefined, 'PARENT'),
      level: 1,
      contact_type: 'parent',
    },
    {
      ...mockProperty('name', undefined, 'GRANDPARENT'),
      level: 2,
      contact_type: 'grandparent',
      required: false,
    },
  ],
  replacement_property: mockProperty('string', undefined, 'replacement'),
  place_properties: [
    mockProperty('name', undefined, 'name'),
    mockProperty(propertyType, propertyValidator)
  ],
  contact_properties: [
    mockProperty('string', undefined, 'name'),
  ],
});

export const mockParentPlace = (parentPlaceType: ContactType, parentName: string) => {
  const place = new Place(parentPlaceType);
  place.properties.name = new UnvalidatedPropertyValue(parentName, 'name');
  return place;
};

export const mockProperty = (type: string, parameter?: string | string[] | object, property_name: string = 'prop'): ContactProperty => ({
  friendly_name: `friendly ${property_name}`,
  property_name,
  type,
  parameter,
  required: true
});

//  Constructor of class ChtSession is private and only accessible within the class declaration.
export function mockChtSession(userFacilityId: string = '*') : ChtSession {
  const creationDetails = {
    authInfo: {
      friendly: 'domain',
      domain: 'domain.com',
      useHttp: true,
    },
    sessionToken: 'session-token',
    username: 'username',
    facilityIds: [userFacilityId],
    chtCoreVersion: '4.7.0',
  };
  return new ChtSession(creationDetails);
}

export function expectInvalidProperties(
  validationErrors: { [key: string]: string } | undefined,
  expectedProperties: string[],
  expectedError?: string
): void {
  expect(Object.keys(validationErrors as any)).to.deep.eq(expectedProperties);

  if (expectedError) {
    expect(Object.values(validationErrors as any)?.[0]).to.include(expectedError);
  }
}
