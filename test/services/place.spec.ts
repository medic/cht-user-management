import { expect } from 'chai';

import Place from '../../src/services/place';
import { mockSimpleContactType, mockValidContactType } from '../mocks';
import RemotePlaceResolver from '../../src/lib/remote-place-resolver';

describe('services/place.ts', () => {
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

  it('basic asRemotePlace', () => {
    const contactType = mockSimpleContactType('string', undefined);
    const place = new Place(contactType);
    place.properties.name = 'name';
    place.resolvedHierarchy[0] = {
      id: 'to-replace',
      name: 'replaced',
      lineage: ['parent-id'],
      type: 'remote',
    };
    place.resolvedHierarchy[1] = {
      id: 'parent-id',
      name: 'parent',
      lineage: [],
      type: 'remote',
    };
    const actual = place.asRemotePlace();

    expect(actual).to.deep.include({
      name: 'name',
      type: 'local',
      lineage: ['parent-id'],
    });
  });

  it('asRemotePlace with great grandfather (missing place in lineage)', () => {
    const contactType = mockSimpleContactType('string', undefined);
    const place = new Place(contactType);
    place.properties.name = 'name';
    place.resolvedHierarchy[0] = {
      id: 'to-replace',
      name: 'replaced',
      lineage: ['parent-id', 'grandparent-id', 'greatgrandparent-id'],
      type: 'remote',
    };

    place.resolvedHierarchy[3] = {
      id: 'greatgrandparent-id',
      name: 'greatgrandparent',
      lineage: [],
      type: 'remote',
    };
    const actual = place.asRemotePlace();

    expect(actual).to.deep.include({
      name: 'name',
      type: 'local',
      lineage: ['parent-id', 'grandparent-id', 'greatgrandparent-id'],
    });
  });

  it('asRemotePlace throws if hierarchy is invalid', () => {
    const contactType = mockSimpleContactType('string', undefined);
    const place = new Place(contactType);
    place.resolvedHierarchy[1] = RemotePlaceResolver.Multiple;
    expect(() => place.asRemotePlace()).to.throw('invalid hierarchy');
  });

  it('generateUsername shouldnt have double underscores', () => {
    const contactType = mockSimpleContactType('string', undefined);
    const place = new Place(contactType);
    place.contact.properties.name = 'Migwani / Itoloni';

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
    place.properties.existing = 'existing';

    const formData = {
      place_prop: 'abc',
      contact_prop: 'efg',
      garbage: 'ghj',
      user_role: 'role1 role2',
    };
    place.setPropertiesFromFormData(formData);

    expect(place.properties).to.deep.eq({
      existing: 'existing',
      prop: 'abc',
    });
    expect(place.contact.properties).to.deep.eq({
      prop: 'efg',
    });
    expect(place.userRoles).to.deep.eq([
      'role1',
      'role2',
    ]);
  });
});
