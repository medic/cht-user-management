import { expect } from 'chai';
import sinon from 'sinon';

import { Config } from '../../src/config';
import Place from '../../src/services/place';
import { mockSimpleContactType, mockValidContactType } from '../mocks';
import { UnvalidatedPropertyValue, ContactPropertyValue } from '../../src/property-value';
import { RemotePlace } from '../../src/lib/remote-place-cache';

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
    } as unknown as RemotePlace;
    place.resolvedHierarchy[1] = {
      id: 'parent-id',
      name: new UnvalidatedPropertyValue('parent'),
      lineage: [],
      type: 'remote',
    } as unknown as RemotePlace;
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
    } as unknown as RemotePlace;

    place.resolvedHierarchy[3] = {
      id: 'greatgrandparent-id',
      name: new UnvalidatedPropertyValue('greatgrandparent'),
      lineage: [],
      type: 'remote',
    } as unknown as RemotePlace;
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

  describe('external identity ownership', () => {
    const OWNERSHIP_ATTRIBUTE = 'chw_registry_link';

    beforeEach(() => {
      sinon.stub(Config, 'getExternalIdentityOwnershipAttribute').returns(OWNERSHIP_ATTRIBUTE);
    });

    afterEach(() => sinon.restore());

    // asChtPayload is what both a new place and a replacement are written from
    it('asChtPayload carries the claim onto the place being created or replaced', () => {
      const contactType = mockSimpleContactType('string', undefined);
      const place = new Place(contactType);
      place.setPropertiesFromFormData({ [OWNERSHIP_ATTRIBUTE]: 'an-external-uuid' }, 'hierarchy_');

      expect(place.asChtPayload('usr')[OWNERSHIP_ATTRIBUTE]).to.eq('an-external-uuid');
    });

    it('asChtPayload marks the place as owned when the claim carries no reference', () => {
      const contactType = mockSimpleContactType('string', undefined);
      const place = new Place(contactType);
      place.setPropertiesFromFormData({ [OWNERSHIP_ATTRIBUTE]: true }, 'hierarchy_');

      expect(place.asChtPayload('usr')[OWNERSHIP_ATTRIBUTE]).to.eq(true);
    });

    it('asChtPayload writes no attribute when ownership was never claimed', () => {
      const contactType = mockSimpleContactType('string', undefined);
      const place = new Place(contactType);
      place.setPropertiesFromFormData({ place_prop: 'abc' }, 'hierarchy_');

      expect(place.externalIdentity).to.be.undefined;
      expect(place.asChtPayload('usr')).to.not.have.property(OWNERSHIP_ATTRIBUTE);
    });

    // nothing to release on a place which does not exist yet
    it('asChtPayload writes no attribute for a release', () => {
      const contactType = mockSimpleContactType('string', undefined);
      const place = new Place(contactType);
      place.setPropertiesFromFormData({ [OWNERSHIP_ATTRIBUTE]: null }, 'hierarchy_');

      expect(place.externalIdentity).to.eq(null);
      expect(place.asChtPayload('usr')).to.not.have.property(OWNERSHIP_ATTRIBUTE);
    });

    // form data is re-applied when a staged place is edited, and must not drop the claim
    it('a later form submission which is silent on ownership keeps the claim', () => {
      const contactType = mockSimpleContactType('string', undefined);
      const place = new Place(contactType);
      place.setPropertiesFromFormData({ [OWNERSHIP_ATTRIBUTE]: 'an-external-uuid' }, 'hierarchy_');
      place.setPropertiesFromFormData({ place_prop: 'abc' }, 'hierarchy_');

      expect(place.externalIdentity).to.eq('an-external-uuid');
    });

    it('rejects a claim which is neither a reference nor a release', () => {
      const contactType = mockSimpleContactType('string', undefined);
      const place = new Place(contactType);

      expect(() => place.setPropertiesFromFormData({ [OWNERSHIP_ATTRIBUTE]: 42 }, 'hierarchy_'))
        .to.throw('must be true, a reference to the external record, or null to release');
    });

    // ownership is opt-in per partner, so a client which sends the field everywhere is not punished
    // for the partners which do not track it
    it('ignores a claim when the partner config names no attribute', () => {
      (Config.getExternalIdentityOwnershipAttribute as sinon.SinonStub).returns(undefined);
      const contactType = mockSimpleContactType('string', undefined);
      const place = new Place(contactType);

      place.setPropertiesFromFormData({ [OWNERSHIP_ATTRIBUTE]: true }, 'hierarchy_');

      expect(place.externalIdentity).to.be.undefined;
      expect(place.asChtPayload('usr')).to.not.have.property(OWNERSHIP_ATTRIBUTE);
    });

    it('ignores a value which is not a valid claim when no attribute is configured', () => {
      (Config.getExternalIdentityOwnershipAttribute as sinon.SinonStub).returns(undefined);
      const contactType = mockSimpleContactType('string', undefined);
      const place = new Place(contactType);

      expect(() => place.setPropertiesFromFormData({ [OWNERSHIP_ATTRIBUTE]: 42 }, 'hierarchy_')).to.not.throw();
    });
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
});
