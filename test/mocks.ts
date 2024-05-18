import { expect } from 'chai';
import Sinon from 'sinon';

import { ChtApi, RemotePlace } from '../src/lib/cht-api';
import ChtSession from '../src/lib/cht-session';
import { ContactProperty, ContactType } from '../src/config';
import Place from '../src/services/place';
import { v4 } from 'uuid';
import { IQueueManager } from '../shared/queues';


export const mockPlace = (type: ContactType, prop: any) : Place => {
  const result = new Place(type);
  result.properties = {
    name: 'place',
    prop
  };
  result.hierarchyProperties = {
    PARENT: 'parent',
  };
  result.contact.properties = {
    name: 'contact',
  };
  result.resolvedHierarchy[1] = {
    id: 'known',
    name: 'parent',
    type: 'remote',
  };
  return result;
};

export const mockChtApi: ChtApi = (first: RemotePlace[] = [], second: RemotePlace[] = []) => ({
  chtSession: mockChtSession(),
  getPlacesWithType: Sinon.stub().resolves(first).onSecondCall().resolves(second),
});

export const mockSimpleContactType = (
  propertyType: string,
  propertyValidator: string | string[] | undefined,
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
    contact_properties: [],
  };
};

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
  place.properties.name = parentName;
  return place;
};

export const mockProperty = (type: string, parameter: string | string[] | undefined | object, property_name: string = 'prop'): ContactProperty => ({
  friendly_name: 'csv',
  property_name,
  type,
  parameter,
  required: true
});

//  Constructor of class ChtSession is private and only accessible within the class declaration.
export const mockChtSession = (userFacilityId: string = '*') : ChtSession => new ChtSession(
  {
    friendly: 'domain',
    domain: 'domain.com',
    useHttp: true,
  },
  'session-token',
  'username',
  userFacilityId
);

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

export const mockQueueManager = (): IQueueManager => ({
  addJob: Sinon.stub().resolves(v4()),
  removeJob: Sinon.stub().resolves(undefined),
  getQueue: Sinon.stub().returns({
    add: Sinon.stub().resolves(v4()),
    remove: Sinon.stub().resolves(undefined),
  }),
});
