import { expect } from 'chai';
import { ChtApi, ChtSession, RemotePlace } from '../src/lib/cht-api';
import { ContactProperty, ContactType } from '../src/lib/config';
import Place from '../src/services/place';
import Sinon from 'sinon';

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
  chtSession: {
    authInfo: {
      domain: 'domain',
    },
    username: 'user',
  },
  getPlacesWithType: Sinon.stub().resolves(first).onSecondCall().resolves(second),
});

export const mockSimpleContactType = (
  propertyType,
  propertyValidator: string | string[] | undefined,
  errorDescription?: string
) : ContactType => {
  const mockedProperty = mockProperty(propertyType, propertyValidator);
  mockedProperty.errorDescription = errorDescription;
  return {
    name: 'contacttype-name',
    friendly: 'friendly',
    contact_type: 'contact-type',
    user_role: 'role',
    username_from_place: false,
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

export const mockValidContactType = (propertyType, propertyValidator: string | string[] | undefined) : ContactType => ({
  name: 'contacttype-name',
  friendly: 'friendly',
  contact_type: 'contact-type',
  user_role: 'role',
  username_from_place: false,
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

export const mockProperty = (type, parameter: string | string[] | undefined, property_name: string = 'prop'): ContactProperty => ({
  friendly_name: 'csv',
  property_name,
  type,
  parameter,
  required: true
});

export const mockChtSession = () : ChtSession => ({
  authInfo: {
    friendly: 'domian',
    domain: 'domain.com',
    useHttp: true,
  },
  sessionToken: 'session-token',
  username: 'username',
});

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

export const mockUserRole = (allowed_roles:  string[]): ContactProperty => ({
  friendly_name: 'Role',
  property_name: 'role',
  parameter: allowed_roles,
  required: true
});

export const mockValidMultipleRolesContactType = (propertyType, propertyValidator: string | string[] | undefined): ContactType => {
  const baseMock = mockValidContactType(propertyType, propertyValidator);

  return {
    ...baseMock,
    user_role: mockUserRole(['role1', 'role2']),
  };
};

export const mockSimpleMultipleRolesContactType = (
  propertyType,
  propertyValidator: string | string[] | undefined,
  errorDescription?: string,
  allowedRoles?: string[],
) : ContactType => {
  const mockedProperty = mockProperty(propertyType, propertyValidator);
  mockedProperty.errorDescription = errorDescription;
  return {
    name: 'contacttype-name',
    friendly: 'friendly',
    contact_type: 'contact-type',
    user_role: mockUserRole(allowedRoles ?? ['role1', 'role2']),
    username_from_place: false,
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
