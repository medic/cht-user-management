import { expect } from 'chai';

import Place, { UploadState } from '../../src/services/place';
import { expectInvalidProperties, mockSimpleContactType, mockSupersetContactType, mockValidContactType } from '../mocks';
import { UnvalidatedPropertyValue, ContactPropertyValue } from '../../src/property-value';

describe('services/place.ts', () => {
  it('setPropertiesFromFormData', () => {
    const contactType = mockSimpleContactType('name', undefined);
    contactType.contact_properties = contactType.place_properties;
    const place = new Place(contactType);
    place.properties.existing = new ContactPropertyValue(place, contactType.place_properties[0], 'place_', 'existing');

    const formData = {
      place_prop: 'abc',
      contact_prop: 'efg',
      garbage: 'ghj',
    };
    place.setPropertiesFromFormData(formData, 'hierarchy_');

    expect(place.properties).to.nested.include({
      'existing.original': 'existing',
      'prop.original': 'abc',
      'prop.formattedValue': 'Abc',
    });
    expect(place.contact.properties).to.nested.include({
      'prop.original': 'efg',
      'prop.formattedValue': 'Efg',
    });
  });

  it('asFormData', () => {
    const contactType = mockSimpleContactType('string', undefined);
    contactType.contact_properties = contactType.place_properties;
    const place = new Place(contactType);
    place.properties.name = new UnvalidatedPropertyValue('name');
    place.properties.prop = new UnvalidatedPropertyValue('abc');
    place.contact.properties.prop = new UnvalidatedPropertyValue('efg');
    const actual = place.asFormData('hierachy_');

    expect(actual).to.deep.eq({
      place_name: 'name',
      place_prop: 'abc',
      contact_prop: 'efg',
    });
  });

  it('basic asRemotePlace', () => {
    const contactType = mockSimpleContactType('string', undefined);
    const place = new Place(contactType);
    place.properties.name = new UnvalidatedPropertyValue('name');
    place.resolvedHierarchy[0] = {
      id: 'to-replace',
      name: new UnvalidatedPropertyValue('replaced'),
      lineage: ['parent-id'],
      type: 'remote',
    };
    place.resolvedHierarchy[1] = {
      id: 'parent-id',
      name: new UnvalidatedPropertyValue('parent'),
      lineage: [],
      type: 'remote',
    };
    const actual = place.asRemotePlace();

    expect(actual).to.deep.nested.include({
      'name.original': 'name',
      type: 'local',
      lineage: ['parent-id'],
    });
  });

  it('asRemotePlace with great grandfather (missing place in lineage)', () => {
    const contactType = mockSimpleContactType('string', undefined);
    const place = new Place(contactType);
    place.properties.name = new UnvalidatedPropertyValue('name');
    place.resolvedHierarchy[0] = {
      id: 'to-replace',
      name: new UnvalidatedPropertyValue('replaced'),
      lineage: ['parent-id', 'grandparent-id', 'greatgrandparent-id'],
      type: 'remote',
    };

    place.resolvedHierarchy[3] = {
      id: 'greatgrandparent-id',
      name: new UnvalidatedPropertyValue('greatgrandparent'),
      lineage: [],
      type: 'remote',
    };
    const actual = place.asRemotePlace();

    expect(actual).to.deep.nested.include({
      'name.original': 'name',
      type: 'local',
      lineage: ['parent-id', 'grandparent-id', 'greatgrandparent-id'],
    });
  });

  it('generateUsername shouldnt have double underscores', () => {
    const contactType = mockSimpleContactType('string', undefined);
    const place = new Place(contactType);
    place.contact.properties.name = new ContactPropertyValue(place, contactType.place_properties[0], 'place_', 'Migwani / Itoloni');

    const actual = place.generateUsername();
    expect(actual).to.eq('migwani_itoloni');
  });

  it('asChtPayload uses contact_type by default', () => {
    const contactType = mockValidContactType('string', undefined);
    Object.freeze(contactType);

    const place = new Place(contactType);
    const actual = place.asChtPayload('usr');
    expect(actual.type).to.eq('contact');
    expect(actual.contact.type).to.eq('contact');
    expect(actual.contact_type).to.eq(contactType.name);
  });

  it('#46 - asChtPayload should use type:health_center instead of contact_type:health_center', () => {
    const contactType = mockValidContactType('string', undefined);
    contactType.name = 'health_center';
    contactType.contact_type = 'person';
    Object.freeze(contactType);

    const place = new Place(contactType);
    const actual = place.asChtPayload('usr');
    expect(actual.type).to.eq(contactType.name);
    expect(actual.contact_type).to.be.undefined;

    expect(actual.contact.type).to.eq(contactType.contact_type);
    expect(actual.contact.contact_type).to.be.undefined;
  });

  it('setPropertiesFromFormData supports multiple roles', () => {
    const contactType = mockSimpleContactType('string', undefined);
    contactType.user_role = ['role1', 'role2'];
    contactType.contact_properties = contactType.place_properties;
    const place = new Place(contactType);

    const formData = {
      place_prop: 'abc',
      contact_prop: 'efg',
      garbage: 'ghj',
      user_role: 'role1 role2',
    };
    place.setPropertiesFromFormData(formData, 'hierarchy_');

    expect(place.userRoles).to.deep.eq([
      'role1',
      'role2',
    ]);
  });

  describe('superset integration', () => {
    it('should handle Superset mode property correctly', () => {
      const contactType = mockSupersetContactType();
      
      const place = new Place(contactType);
      const formData = {
        superset_mode: 'enable'
      };
      
      place.setPropertiesFromFormData(formData, 'hierarchy_');
      expect(place.shouldUploadToSuperset()).to.be.true;
    });

    it('should throw an error when email is missing in the contact properties', () => {
      const contactType = mockSupersetContactType(false);
      
      const place = new Place(contactType);
      const formData = {
        superset_mode: 'enable',
      };
      
      place.setPropertiesFromFormData(formData, 'hierarchy_');
      expect(() => place.validate()).to.throw(/missing the required "email" contact property/);
    });

    it('should require email when Superset is enabled', () => {
      const contactType = mockSupersetContactType();
      
      const place = new Place(contactType);
      const formData = {
        superset_mode: 'enable',
        place_name: 'place',
        place_prop: 'prop',
        contact_name: 'contact',
        hierarchy_PARENT: 'parent',
      };
      
      place.setPropertiesFromFormData(formData, 'hierarchy_');
      place.resolvedHierarchy[1] = {
        id: 'known',
        name: new UnvalidatedPropertyValue('parent'),
        lineage: [],
        type: 'remote',
      };
      place.validate();
      expectInvalidProperties(place.validationErrors, ['contact_email'], 'Required');
    });
    

    it('should track Superset upload state', () => {
      const contactType = mockSupersetContactType();
      const place = new Place(contactType);

      const formData = {
        superset_mode: 'enable',
        contact_email: 'test@example.com',
      };
      
      place.setPropertiesFromFormData(formData, 'hierarchy_');

      expect(place.isSupersetCreated).to.be.false;
      expect(place.isSupersetUploadIncomplete()).to.be.true;
      
      place.supersetUploadState = UploadState.SUCCESS;
      place.creationDetails.password = 'password';
      expect(place.isSupersetCreated).to.be.true;
      expect(place.isSupersetUploadIncomplete()).to.be.false;
      
      place.supersetUploadState = UploadState.FAILURE;
      delete place.creationDetails.password;
      expect(place.isSupersetUploadIncomplete()).to.be.true;
    });
  });
});
