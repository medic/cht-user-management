import Chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';

import { Config, ContactType } from '../../src/config';
// property-value and validation/remote-place-resolver are circular; loading remote-place-cache
// before the service under test leaves UnvalidatedPropertyValue undefined at import time
import { UpdatePlaceDetails } from '../../src/services/update-place-details';
import RemotePlaceCache from '../../src/lib/remote-place-cache';
import { mockChtSession } from '../mocks';

Chai.use(chaiAsPromised);

const { expect } = Chai;

const PLACE_ID = 'chp-area-1';
const CONTACT_ID = 'chp-contact-1';

// Mirrors chis-ke's `d_community_health_volunteer_area`: the place name is generated from the
// contact name, so an edit to "CHP Name" renames the area too.
const CONTACT_TYPE: ContactType = {
  name: 'd_community_health_volunteer_area',
  friendly: 'Community Health Promoter',
  contact_type: 'person',
  user_role: ['community_health_volunteer'],
  username_from_place: false,
  deactivate_users_on_replace: false,
  hierarchy: [{
    friendly_name: 'CHU',
    property_name: 'CHU',
    contact_type: 'c_community_health_unit',
    type: 'name',
    required: true,
    level: 1,
  }],
  replacement_property: {
    friendly_name: 'Outgoing CHP', property_name: 'replacement', type: 'name', required: true,
  },
  place_properties: [
    {
      friendly_name: 'CHP Area Name',
      property_name: 'name',
      type: 'generated',
      parameter: '{{ contact.name }} Area',
      required: true,
    },
  ],
  contact_properties: [
    { friendly_name: 'CHP Name', property_name: 'name', type: 'name', required: true },
    { friendly_name: 'CHP Phone', property_name: 'phone', type: 'phone', parameter: 'KE', required: true },
    { friendly_name: 'Notes', property_name: 'notes', type: 'string', required: false },
  ],
};

function chpAreaDoc(overrides: any = {}) {
  return {
    _id: PLACE_ID,
    _rev: '1-abc',
    type: 'contact',
    contact_type: 'd_community_health_volunteer_area',
    name: 'Jane Doe Area',
    parent: { _id: 'chu-1' },
    contact: { _id: CONTACT_ID },
    ...overrides,
  };
}

function chpContactDoc(overrides: any = {}) {
  return {
    _id: CONTACT_ID,
    _rev: '1-def',
    type: 'person',
    name: 'Jane Doe',
    phone: '+254712345678',
    ...overrides,
  };
}

// every reported change carries the value which was replaced alongside the value written
function change(previous: any, current: any) {
  return { previous, current };
}

function mockApi(docs: any[]) {
  const byId = new Map(docs.map(doc => [doc._id, doc]));
  return {
    chtSession: mockChtSession(),
    getDoc: sinon.stub().callsFake(async (id: string) => {
      const doc = byId.get(id);
      if (!doc) {
        const notFound: any = new Error('Request failed with status code 404');
        notFound.response = { status: 404 };
        throw notFound;
      }
      return doc;
    }),
    setDoc: sinon.stub().resolves(),
  } as any;
}

describe('services/update-place-details.ts', () => {
  let updateCacheStub: sinon.SinonStub;

  beforeEach(() => {
    updateCacheStub = sinon.stub(RemotePlaceCache, 'updateFromDoc');
  });

  afterEach(() => sinon.restore());

  it('updates the contact name and phone, and regenerates the place name', async () => {
    const placeDoc = chpAreaDoc();
    const contactDoc = chpContactDoc();
    const chtApi = mockApi([placeDoc, contactDoc]);

    const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, {
      contact_name: 'janet doe',
      contact_phone: '0722222222',
    }, chtApi);

    expect(result).to.deep.include({
      success: true,
      place_id: PLACE_ID,
      contact_id: CONTACT_ID,
    });
    expect((result as any).contact).to.deep.equal({
      name: change('Jane Doe', 'Janet Doe'),
      phone: change('+254712345678', '+254722222222'),
    });
    // the generated place name follows the contact rename without being asked for
    expect((result as any).place).to.deep.equal({ name: change('Jane Doe Area', 'Janet Doe Area') });

    expect(chtApi.setDoc.callCount).to.equal(2);
    // the contact is written before the place so the place never points at a stale contact
    expect(chtApi.setDoc.getCall(0).args[0]).to.equal(CONTACT_ID);
    expect(chtApi.setDoc.getCall(0).args[1]).to.deep.include({ name: 'Janet Doe', phone: '+254722222222' });
    expect(chtApi.setDoc.getCall(1).args[0]).to.equal(PLACE_ID);
    expect(chtApi.setDoc.getCall(1).args[1]).to.deep.include({ name: 'Janet Doe Area' });
  });

  it('patches the cached entry for the place, rather than dropping the whole snapshot', async () => {
    const placeDoc = chpAreaDoc();
    const chtApi = mockApi([placeDoc, chpContactDoc()]);

    await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { contact_name: 'Janet Doe' }, chtApi);

    expect(updateCacheStub.calledOnce).to.be.true;
    const [api, contactType, doc] = updateCacheStub.firstCall.args;
    expect(api).to.equal(chtApi);
    expect(contactType).to.equal(CONTACT_TYPE);
    // the doc as written, so the cached entry is rebuilt from the new name
    expect(doc).to.equal(placeDoc);
    expect(doc.name).to.equal('Janet Doe Area');
  });

  // only the place is cached remotely, so a contact-only edit leaves the snapshot correct
  it('leaves the cache alone when only the contact changed', async () => {
    const chtApi = mockApi([chpAreaDoc(), chpContactDoc()]);

    await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { contact_phone: '0722222222' }, chtApi);

    expect(chtApi.setDoc.calledOnce).to.be.true;
    expect(updateCacheStub.called).to.be.false;
  });

  it('writes nothing when the supplied values match what is already on the instance', async () => {
    const chtApi = mockApi([chpAreaDoc(), chpContactDoc()]);

    const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, {
      contact_name: 'Jane Doe',
      contact_phone: '0712345678',
    }, chtApi);

    expect(result).to.deep.equal({
      success: true,
      place_id: PLACE_ID,
      contact_id: CONTACT_ID,
      place: {},
      contact: {},
    });
    expect(chtApi.setDoc.called).to.be.false;
    expect(updateCacheStub.called).to.be.false;
  });

  it('leaves a property which was not supplied and needs no formatting alone', async () => {
    const contactDoc = chpContactDoc({ notes: 'do not clobber me' });
    const chtApi = mockApi([chpAreaDoc(), contactDoc]);

    const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { contact_phone: '0722222222' }, chtApi);

    expect(Object.keys((result as any).contact)).to.deep.equal(['phone']);
    expect(chtApi.setDoc.getCall(0).args[1].notes).to.equal('do not clobber me');
  });

  // every property is written from its validated value, so an edit also normalizes what it finds
  it('normalizes a stored value the validators format differently, even when not supplied', async () => {
    const chtApi = mockApi([chpAreaDoc(), chpContactDoc({ name: 'jane doe' })]);

    const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { contact_phone: '0722222222' }, chtApi);

    expect((result as any).contact).to.deep.equal({
      name: change('jane doe', 'Jane Doe'),
      phone: change('+254712345678', '+254722222222'),
    });
  });

  describe('external identity ownership', () => {
    const OWNERSHIP_ATTRIBUTE = 'chw_registry_link';

    beforeEach(() => {
      sinon.stub(Config, 'getExternalIdentityOwnershipAttribute').returns(OWNERSHIP_ATTRIBUTE);
    });

    it('claims the place for the external system without a reference', async () => {
      const placeDoc = chpAreaDoc();
      const chtApi = mockApi([placeDoc, chpContactDoc()]);

      const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { [OWNERSHIP_ATTRIBUTE]: true }, chtApi);

      expect((result as any).place).to.deep.equal({ [OWNERSHIP_ATTRIBUTE]: change(null, true) });
      expect(chtApi.setDoc.calledOnce).to.be.true;
      expect(chtApi.setDoc.getCall(0).args[1][OWNERSHIP_ATTRIBUTE]).to.equal(true);
    });

    it('claims the place with a link back to the external record', async () => {
      const chtApi = mockApi([chpAreaDoc(), chpContactDoc()]);
      const externalId = '550e8400-e29b-41d4-a716-446655440000';

      const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { [OWNERSHIP_ATTRIBUTE]: externalId }, chtApi);

      expect((result as any).place).to.deep.equal({ [OWNERSHIP_ATTRIBUTE]: change(null, externalId) });
      expect(chtApi.setDoc.getCall(0).args[1][OWNERSHIP_ATTRIBUTE]).to.equal(externalId);
    });

    it('sets ownership alongside a property edit in the one write', async () => {
      const chtApi = mockApi([chpAreaDoc(), chpContactDoc()]);

      const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, {
        contact_name: 'Janet Doe',
        [OWNERSHIP_ATTRIBUTE]: true,
      }, chtApi);

      expect((result as any).contact).to.deep.equal({ name: change('Jane Doe', 'Janet Doe') });
      expect((result as any).place).to.deep.equal({
        name: change('Jane Doe Area', 'Janet Doe Area'),
        [OWNERSHIP_ATTRIBUTE]: change(null, true),
      });
      // one write per doc, ownership included
      expect(chtApi.setDoc.callCount).to.equal(2);
    });

    it('releases the place by removing the attribute', async () => {
      const placeDoc = chpAreaDoc({ [OWNERSHIP_ATTRIBUTE]: 'an-external-uuid' });
      const chtApi = mockApi([placeDoc, chpContactDoc()]);

      const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { [OWNERSHIP_ATTRIBUTE]: null }, chtApi);

      expect((result as any).place).to.deep.equal({ [OWNERSHIP_ATTRIBUTE]: change('an-external-uuid', null) });
      // removed from the doc rather than left behind as a falsy value
      expect(chtApi.setDoc.getCall(0).args[1]).to.not.have.property(OWNERSHIP_ATTRIBUTE);
    });

    it('treats false as a release', async () => {
      const chtApi = mockApi([chpAreaDoc({ [OWNERSHIP_ATTRIBUTE]: true }), chpContactDoc()]);

      const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { [OWNERSHIP_ATTRIBUTE]: false }, chtApi);

      expect((result as any).place).to.deep.equal({ [OWNERSHIP_ATTRIBUTE]: change(true, null) });
    });

    it('leaves ownership alone when the payload does not mention it', async () => {
      const chtApi = mockApi([chpAreaDoc({ [OWNERSHIP_ATTRIBUTE]: 'an-external-uuid' }), chpContactDoc()]);

      const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { contact_phone: '0722222222' }, chtApi);

      expect((result as any).place).to.deep.equal({});
      expect(chtApi.setDoc.calledOnce).to.be.true;
    });

    it('writes nothing when the place is already owned by the same record', async () => {
      const chtApi = mockApi([chpAreaDoc({ [OWNERSHIP_ATTRIBUTE]: 'an-external-uuid' }), chpContactDoc()]);

      const result = await UpdatePlaceDetails.update(
        PLACE_ID, CONTACT_TYPE, { [OWNERSHIP_ATTRIBUTE]: 'an-external-uuid' }, chtApi
      );

      expect((result as any).place).to.deep.equal({});
      expect(chtApi.setDoc.called).to.be.false;
    });

    it('releasing a place which was never owned writes nothing', async () => {
      const chtApi = mockApi([chpAreaDoc(), chpContactDoc()]);

      const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { [OWNERSHIP_ATTRIBUTE]: null }, chtApi);

      expect((result as any).place).to.deep.equal({});
      expect(chtApi.setDoc.called).to.be.false;
    });

    it('rejects a value which is neither a claim nor a release', async () => {
      const chtApi = mockApi([chpAreaDoc(), chpContactDoc()]);

      await expect(UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { [OWNERSHIP_ATTRIBUTE]: '  ' }, chtApi))
        .to.eventually.be.rejectedWith('must be true, a reference to the external record, or null to release');
      expect(chtApi.setDoc.called).to.be.false;
    });

    // ownership is opt-in per partner: on a config which names no attribute the caller is asking
    // for something this deployment cannot do, so it is an error rather than a silent no-op
    it('rejects ownership when the partner config names no attribute', async () => {
      (Config.getExternalIdentityOwnershipAttribute as sinon.SinonStub).returns(undefined);
      const chtApi = mockApi([chpAreaDoc(), chpContactDoc()]);

      const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { [OWNERSHIP_ATTRIBUTE]: true }, chtApi);

      expect((result as any).success).to.be.false;
      expect((result as any).errors).to.have.all.keys(OWNERSHIP_ATTRIBUTE);
      expect(chtApi.setDoc.called).to.be.false;
    });

    it('updates the cached entry, since ownership is written on the place', async () => {
      const chtApi = mockApi([chpAreaDoc(), chpContactDoc()]);

      await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { [OWNERSHIP_ATTRIBUTE]: true }, chtApi);

      expect(updateCacheStub.calledOnce).to.be.true;
    });
  });

  it('appends an audit trail of the change to the doc', async () => {
    const chtApi = mockApi([chpAreaDoc(), chpContactDoc()]);

    await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { contact_phone: '0722222222' }, chtApi);

    const [edit] = chtApi.setDoc.getCall(0).args[1].user_attribution.edits;
    expect(edit.username).to.equal('username');
    expect(edit.tool).to.match(/^cht-user-management-/);
    expect(edit.edited_time).to.be.a('number');
    expect(edit.changes).to.deep.equal({ phone: change('+254712345678', '+254722222222') });
  });

  it('rejects an invalid value without writing anything', async () => {
    const chtApi = mockApi([chpAreaDoc(), chpContactDoc()]);

    const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { contact_phone: '12' }, chtApi);

    expect(result).to.deep.equal({
      success: false,
      errors: { contact_phone: 'Not a valid KE phone number' },
    });
    expect(chtApi.setDoc.called).to.be.false;
  });

  it('rejects clearing a required property', async () => {
    const chtApi = mockApi([chpAreaDoc(), chpContactDoc()]);

    const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { contact_name: '' }, chtApi);

    expect((result as any).success).to.be.false;
    expect((result as any).errors.contact_name).to.equal('Is Required');
    expect(chtApi.setDoc.called).to.be.false;
  });

  it('clears an optional property when it is explicitly emptied', async () => {
    const chtApi = mockApi([chpAreaDoc(), chpContactDoc({ notes: 'stale note' })]);

    const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { contact_notes: '' }, chtApi);

    expect((result as any).contact).to.deep.equal({ notes: change('stale note', '') });
    expect(chtApi.setDoc.getCall(0).args[1].notes).to.equal('');
  });

  // the whole place is validated, not just what is being edited: a place which does not validate
  // as a whole is not one to write to
  it('reports a property which is invalid on the instance even when it is not being edited', async () => {
    // a place whose phone predates the phone validation rule
    const chtApi = mockApi([chpAreaDoc(), chpContactDoc({ phone: 'not a phone' })]);

    const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { contact_name: 'Janet Doe' }, chtApi);

    expect(result).to.deep.equal({
      success: false,
      errors: { contact_phone: 'Not a valid KE phone number' },
    });
    expect(chtApi.setDoc.called).to.be.false;
  });

  it('reads only the place and its contact, trusting the hierarchy on the doc', async () => {
    const chtApi = mockApi([chpAreaDoc(), chpContactDoc()]);

    await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { contact_name: 'Janet Doe' }, chtApi);

    expect(chtApi.getDoc.args.map((args: any[]) => args[0])).to.deep.equal([PLACE_ID, CONTACT_ID]);
  });

  // the hierarchy is not resolved, so regenerating such a value would drop the lineage from it
  it('refuses a contact type whose generated property is built from the hierarchy', async () => {
    const contactTypeWithLineage: ContactType = {
      ...CONTACT_TYPE,
      place_properties: [{
        friendly_name: 'CHP Area Name',
        property_name: 'name',
        type: 'generated',
        parameter: '{{ contact.name }} Area ({{ lineage.CHU }})',
        required: true,
      }],
    };
    const chtApi = mockApi([chpAreaDoc(), chpContactDoc()]);

    await expect(UpdatePlaceDetails.update(PLACE_ID, contactTypeWithLineage, { contact_name: 'Janet Doe' }, chtApi))
      .to.eventually.be.rejectedWith(
        'cannot edit "d_community_health_volunteer_area": the generated property "name" is built from the hierarchy'
      );
    // refused from the config alone, before anything is read
    expect(chtApi.getDoc.called).to.be.false;
    expect(chtApi.setDoc.called).to.be.false;
  });

  it('refuses a generated contact property built from the hierarchy too', async () => {
    const contactTypeWithLineage: ContactType = {
      ...CONTACT_TYPE,
      contact_properties: [
        ...CONTACT_TYPE.contact_properties,
        {
          friendly_name: 'Label',
          property_name: 'label',
          type: 'generated',
          parameter: '{{ contact.name }} of {{ lineage.CHU }}',
          required: false,
        },
      ],
    };
    const chtApi = mockApi([chpAreaDoc(), chpContactDoc()]);

    await expect(UpdatePlaceDetails.update(PLACE_ID, contactTypeWithLineage, { contact_name: 'Janet Doe' }, chtApi))
      .to.eventually.be.rejectedWith('the generated property "label" is built from the hierarchy');
  });

  // the CHU level is required, but the place is already filed and this endpoint cannot move it
  it('does not report the hierarchy, even when the place has no parent at all', async () => {
    const chtApi = mockApi([chpAreaDoc({ parent: undefined }), chpContactDoc()]);

    const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { contact_name: 'Janet Doe' }, chtApi);

    expect((result as any).success).to.be.true;
    expect((result as any).contact).to.deep.equal({ name: change('Jane Doe', 'Janet Doe') });
  });

  describe('unrecognized properties', () => {
    it('rejects a misspelled property rather than dropping it', async () => {
      const chtApi = mockApi([chpAreaDoc(), chpContactDoc()]);

      const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { contact_naem: 'Janet Doe' }, chtApi);

      expect(result).to.deep.equal({
        success: false,
        errors: {
          contact_naem: 'is not a property of "d_community_health_volunteer_area"',
        },
      });
      // refused from the config alone, before anything is read
      expect(chtApi.getDoc.called).to.be.false;
      expect(chtApi.setDoc.called).to.be.false;
    });

    it('reports every unrecognized key, not just the first', async () => {
      const chtApi = mockApi([chpAreaDoc(), chpContactDoc()]);

      const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, {
        contact_naem: 'Janet Doe',
        contact_phne: '0722222222',
      }, chtApi);

      expect((result as any).errors).to.have.all.keys('contact_naem', 'contact_phne');
    });

    // a property named without its prefix reads as a different property, so it must not be honoured
    it('rejects a property missing its prefix', async () => {
      const chtApi = mockApi([chpAreaDoc(), chpContactDoc()]);

      const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { name: 'Janet Doe' }, chtApi);

      expect((result as any).success).to.be.false;
      expect(chtApi.setDoc.called).to.be.false;
    });

    // this endpoint edits neither the hierarchy nor the user, so being asked to is an error
    it('rejects hierarchy and user properties', async () => {
      const chtApi = mockApi([chpAreaDoc(), chpContactDoc()]);

      const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, {
        hierarchy_CHU: 'Some Other CHU',
        user_role: 'community_health_volunteer',
      }, chtApi);

      expect((result as any).errors).to.have.all.keys('hierarchy_CHU', 'user_role');
      expect(chtApi.setDoc.called).to.be.false;
    });

    it('accepts every configured place and contact property', async () => {
      const chtApi = mockApi([chpAreaDoc(), chpContactDoc()]);

      const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, {
        place_name: 'Janet Doe Area',
        contact_name: 'Janet Doe',
        contact_phone: '0722222222',
        contact_notes: 'a note',
      }, chtApi);

      expect((result as any).success).to.be.true;
    });

    it('accepts the ownership attribute the partner config names', async () => {
      sinon.stub(Config, 'getExternalIdentityOwnershipAttribute').returns('chw_registry_link');
      const chtApi = mockApi([chpAreaDoc(), chpContactDoc()]);

      const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { chw_registry_link: true }, chtApi);

      expect((result as any).success).to.be.true;
    });

    it('accepts an empty payload, which asks for no edit', async () => {
      const chtApi = mockApi([chpAreaDoc(), chpContactDoc()]);

      const result = await UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, {}, chtApi);

      expect((result as any).success).to.be.true;
      expect(chtApi.setDoc.called).to.be.false;
    });
  });

  it('rejects a place which does not exist', async () => {
    const chtApi = mockApi([]);

    await expect(UpdatePlaceDetails.update('nope', CONTACT_TYPE, { contact_name: 'Janet' }, chtApi))
      .to.eventually.be.rejectedWith('place "nope" was not found on this instance');
  });

  it('rejects a place which is not of the contact type the caller declared', async () => {
    const chtApi = mockApi([chpAreaDoc({ contact_type: 'c_community_health_unit' }), chpContactDoc()]);

    await expect(UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { contact_name: 'Janet' }, chtApi))
      .to.eventually.be.rejectedWith(
        `place "${PLACE_ID}" is of type "c_community_health_unit", not "d_community_health_volunteer_area"`
      );
    expect(chtApi.setDoc.called).to.be.false;
  });

  it('matches the declared type against a doc which has no contact_type', async () => {
    const chtApi = mockApi([chpAreaDoc({ contact_type: undefined, type: 'health_center' }), chpContactDoc()]);

    await expect(UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { contact_name: 'Janet' }, chtApi))
      .to.eventually.be.rejectedWith('is of type "health_center"');
  });

  it('rejects contact edits on a place with no primary contact', async () => {
    const chtApi = mockApi([chpAreaDoc({ contact: undefined })]);

    await expect(UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { contact_name: 'Janet' }, chtApi))
      .to.eventually.be.rejectedWith('has no primary contact to update');
  });

  it('reports that the contact was already written when the place write fails', async () => {
    const chtApi = mockApi([chpAreaDoc(), chpContactDoc()]);
    chtApi.setDoc.onSecondCall().rejects(new Error('conflict'));

    await expect(UpdatePlaceDetails.update(PLACE_ID, CONTACT_TYPE, { contact_name: 'Janet Doe' }, chtApi))
      .to.eventually.be.rejectedWith(`conflict (the contact "${CONTACT_ID}" was already updated)`);
    expect(updateCacheStub.called).to.be.false;
  });
});
