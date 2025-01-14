import _ from 'lodash';
import { expect } from 'chai';
import sinon from 'sinon';

import { UploadManager } from '../../src/services/upload-manager';
import { mockValidContactType, mockParentPlace, mockChtSession, expectInvalidProperties, ChtDoc, createChu } from '../mocks';
import PlaceFactory from '../../src/services/place-factory';
import SessionCache from '../../src/services/session-cache';
import RemotePlaceCache from '../../src/lib/remote-place-cache';
import { Config } from '../../src/config';
import RemotePlaceResolver from '../../src/lib/remote-place-resolver';
import { UploadManagerRetryScenario } from '../lib/retry-logic.spec';

describe('services/upload-manager.ts', () => {
  beforeEach(() => {
    RemotePlaceCache.clear({});
  });

  it('mock data is properly sent to chtApi - standard', async () => {
    const { fakeFormData, contactType, chtApi, sessionCache, subcounty } = await createMocks();
    const place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);

    const uploadManager = new UploadManager();
    await uploadManager.doUpload([place], chtApi);

    expect(chtApi.createPlace.calledOnce).to.be.true;
    const placePayload = chtApi.createPlace.args[0][0];
    expect(placePayload).to.nested.include({
      'contact.contact_type': contactType.contact_type,
      'contact.name': 'contact',
      prop: 'foo',
      name: 'Place Community Health Unit',
      parent: subcounty._id,
      contact_type: contactType.name,
    });

    expect(chtApi.createUser.calledOnce).to.be.true;
    const userPayload = chtApi.createUser.args[0][0];
    expect(userPayload).to.deep.include({
      contact: 'created-contact-id',
      place: 'created-place-id',
      roles: ['role'],
      username: 'contact',
    });
    expect(chtApi.deleteDoc.called).to.be.false;
    expect(place.isCreated).to.be.true;
  });

  it('mock data is properly sent to chtApi - sessionCache cache', async () => {
    const { fakeFormData, contactType, sessionCache, chtApi, subcounty } = await createMocks();

    const parentContactType = mockValidContactType('string', undefined);
    parentContactType.name = subcounty.name;

    const parentPlace = mockParentPlace(parentContactType, subcounty.name);
    sessionCache.savePlaces(parentPlace);
    const place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    const uploadManager = new UploadManager();
    await uploadManager.doUpload([place], chtApi);

    expect(chtApi.getPlacesWithType.callCount).to.eq(3);
    expect(chtApi.deleteDoc.called).to.be.false;
    expect(place.isCreated).to.be.true;
  });

  it('uploads in batches', async () => {
    const placeCount = 11;
    const { fakeFormData, contactType, sessionCache, chtApi } = await createMocks();
    const place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    const places = Array(placeCount).fill(place).map(p => _.cloneDeep(p));
    const uploadManager = new UploadManager();
    await uploadManager.doUpload(places, chtApi);
    expect(chtApi.createUser.callCount).to.eq(placeCount);
    expect(places.find(p => !p.isCreated)).to.be.undefined;
  });

  it('required attributes can be inherited during replacement', async () => {
    const { subcounty, sessionCache, contactType, fakeFormData, chtApi } = await createMocks();
    fakeFormData.hierarchy_replacement = 'to-replace';
    fakeFormData.place_prop = ''; // required during creation, but can be empty (ui) or undefined (csv)
    fakeFormData.place_name = undefined;

    const toReplace: ChtDoc = {
      _id: 'id-replace',
      name: 'to-replace',
      parent: { _id: subcounty._id },
    };

    chtApi.getPlacesWithType
      .onFirstCall().resolves([])
      .onSecondCall().resolves([subcounty])
      .onThirdCall().resolves([toReplace]);

    const place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty; // only parent is required when replacing

    const uploadManager = new UploadManager();
    await uploadManager.doUpload([place], chtApi);
    expect(chtApi.updatePlace.calledOnce).to.be.true;
    expect(chtApi.updatePlace.args[0][0]).to.not.have.property('prop');
    expect(chtApi.updatePlace.args[0][0]).to.not.have.property('name');
    expect(chtApi.deleteDoc.calledOnce).to.be.true;
    expect(place.isCreated).to.be.true;
  });

  it('contact_type replacement with username_from_place:true', async () => {
    const { subcounty, sessionCache, contactType, fakeFormData, chtApi } = await createMocks();
    contactType.username_from_place = true;

    fakeFormData.hierarchy_replacement = 'replacement based username';
    fakeFormData.place_name = ''; // optional due to replacement

    const toReplace: ChtDoc = {
      _id: 'id-replace',
      name: 'replac"e$mENT baSed username',
      parent: { _id: subcounty._id },
    };

    chtApi.getPlacesWithType
      .onFirstCall().resolves([])
      .onSecondCall().resolves([subcounty])
      .onThirdCall().resolves([toReplace]);

    const place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty; // only parent is required when replacing

    const uploadManager = new UploadManager();
    await uploadManager.doUpload([place], chtApi);
    expect(chtApi.createUser.args[0][0]).to.deep.include({
      username: 'replacement_based_username',
    });
    expect(place.isCreated).to.be.true;
  });

  it('contact_type replacement with deactivate_users_on_replace:true', async () => {
    const { subcounty, sessionCache, contactType, fakeFormData, chtApi } = await createMocks();
    contactType.deactivate_users_on_replace = true;

    fakeFormData.hierarchy_replacement = 'deactivate me';
    fakeFormData.place_name = ''; // optional due to replacement

    const toReplace: ChtDoc = {
      _id: 'id-replace',
      name: 'deactivate me',
      parent: { _id: subcounty._id },
    };

    chtApi.getPlacesWithType
      .onFirstCall().resolves([])
      .onSecondCall().resolves([subcounty])
      .onThirdCall().resolves([toReplace]);

    const place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty; // only parent is required when replacing

    const uploadManager = new UploadManager();
    await uploadManager.doUpload([place], chtApi);
    expect(chtApi.createUser.callCount).to.eq(1);
    expect(chtApi.disableUser.called).to.be.false;
    expect(chtApi.deleteDoc.called).to.be.false;
    expect(chtApi.updateUser.called).to.be.true;
    expect(chtApi.updateUser.args[0][0]).to.deep.eq({
      username: 'user',
      roles: ['deactivated'],
    });
    expect(place.isCreated).to.be.true;
  });

  it('place with validation error is not uploaded', async () => {
    const { sessionCache, contactType, fakeFormData, chtApi } = await createMocks();
    delete fakeFormData.place_name;
    const place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.not.be.empty;

    const uploadManager = new UploadManager();
    await uploadManager.doUpload([place], chtApi);
    expect(chtApi.createUser.called).to.be.false;
    expect(place.isCreated).to.be.false;
  });

  it('uploading a chu and dependant chp where chp is created first', async () => {
    const { subcounty, sessionCache, chtApi } = await createMocks();

    chtApi.getPlacesWithType
      .onFirstCall().resolves([subcounty])
      .onSecondCall().resolves([]);

    const chu_name = 'new chu';
    const chpType = await Config.getContactType('d_community_health_volunteer_area');
    const chpData = {
      hierarchy_CHU: chu_name,
      place_name: 'new chp',
      contact_name: 'new chp',
      contact_phone: '0788889999',
    };

    // CHP has validation errors because it references a CHU which does not exist
    const chp = await PlaceFactory.createOne(chpData, chpType, sessionCache, chtApi);
    expectInvalidProperties(chp.validationErrors, ['hierarchy_CHU'], 'Cannot find');

    const chu = await createChu(subcounty, chu_name, sessionCache, chtApi);

    // refresh the chp
    await RemotePlaceResolver.resolveOne(chp, sessionCache, chtApi, { fuzz: true });
    chp.validate();
    expect(chp.validationErrors).to.be.empty;

    // upload succeeds
    chtApi.getParentAndSibling = sinon.stub().resolves({ parent: chu.asChtPayload('user'), sibling: undefined });
    const uploadManager = new UploadManager();
    await uploadManager.doUpload(sessionCache.getPlaces(), chtApi);
    expect(chu.isCreated).to.be.true;
    expect(chp.isCreated).to.be.true;

    // chu is created first
    expect(chtApi.createUser.args[0][0].roles).to.deep.eq(['community_health_assistant']);
    expect(chtApi.createUser.args[1][0].roles).to.deep.eq(['community_health_volunteer']);
  });

  it('failure to upload', async () => {
    const { subcounty, sessionCache, chtApi } = await createMocks();

    chtApi.getPlacesWithType
      .onFirstCall().resolves([subcounty])
      .onSecondCall().resolves([]);
      
    chtApi.createUser
      .throws({ response: { status: 404 }, toString: () => 'upload-error' })
      .onSecondCall().resolves();

    const chu_name = 'new chu';
    const chu = await createChu(subcounty, chu_name, sessionCache, chtApi);

    const uploadManager = new UploadManager();
    await uploadManager.doUpload(sessionCache.getPlaces(), chtApi);
    expect(chu.isCreated).to.be.false;
    expect(chtApi.createUser.calledOnce).to.be.true;
    expect(chu.uploadError).to.include('upload-error');
    expect(chu.creationDetails).to.deep.eq({
      contactId: 'created-contact-id',
      placeId: 'created-place-id',
    });

    await uploadManager.doUpload(sessionCache.getPlaces(), chtApi);
    expect(chu.isCreated).to.be.true;
    expect(chu.uploadError).to.be.undefined;
    expect(chu.creationDetails).to.deep.include({
      contactId: 'created-contact-id',
      placeId: 'created-place-id',
      username: 'new'
    });
    expect(chu.creationDetails.password).to.not.be.undefined;

    expect(chtApi.createPlace.callCount).to.eq(1);
    expect(chtApi.createUser.callCount).to.eq(2);
    expect(chtApi.getParentAndSibling.called).to.be.false;
    expect(chtApi.createContact.called).to.be.false;
    expect(chtApi.updatePlace.called).to.be.false;
    expect(chtApi.deleteDoc.called).to.be.false;
    expect(chtApi.disableUser.called).to.be.false;
    expect(chtApi.updateUser.called).to.be.false;
  });

  it('#146 - error details are clear when CHT returns a string', async () => {
    const { subcounty, sessionCache, chtApi } = await createMocks();
    const errorString = 'foo';

    chtApi.getPlacesWithType
      .onFirstCall().resolves([subcounty])
      .onSecondCall().resolves([]);
      
    chtApi.createPlace.throws({ response: { data: errorString } });

    const chu_name = 'new chu';
    const chu = await createChu(subcounty, chu_name, sessionCache, chtApi);

    const uploadManager = new UploadManager();
    await uploadManager.doUpload(sessionCache.getPlaces(), chtApi);
    expect(chu.isCreated).to.be.false;
    expect(chtApi.createUser.called).to.be.false;
    expect(chu.uploadError).to.include(errorString);
  });

  it(`createUser is retried`, async() => {
    const { subcounty, sessionCache, chtApi } = await createMocks();

    chtApi.getPlacesWithType
      .onFirstCall().resolves([subcounty])
      .onSecondCall().resolves([]);
    chtApi.createUser.throws(UploadManagerRetryScenario.axiosError);

    const chu_name = 'new chu';
    const chu = await createChu(subcounty, chu_name, sessionCache, chtApi);

    const uploadManager = new UploadManager();
    await uploadManager.doUpload(sessionCache.getPlaces(), chtApi);
    expect(chu.isCreated).to.be.false;
    expect(chtApi.createUser.callCount).to.be.gt(2); // retried
    expect(chu.uploadError).to.include('could not create user');  
  });

  it('mock data is properly sent to chtApi - multiple roles', async () => {
    const { fakeFormData, contactType, chtApi, sessionCache, subcounty } = await createMocks();

    contactType.user_role = ['role1', 'role2'];
    fakeFormData.user_role = 'role1 role2';

    const place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);

    const uploadManager = new UploadManager();
    await uploadManager.doUpload([place], chtApi);

    expect(chtApi.createPlace.calledOnce).to.be.true;
    const placePayload = chtApi.createPlace.args[0][0];
    expect(placePayload).to.nested.include({
      'contact.contact_type': contactType.contact_type,
      'contact.name': 'contact',
      prop: 'foo',
      name: 'Place Community Health Unit',
      parent: subcounty._id,
      contact_type: contactType.name,
    });

    expect(chtApi.createUser.calledOnce).to.be.true;
    const userPayload = chtApi.createUser.args[0][0];
    expect(userPayload).to.deep.include({
      contact: 'created-contact-id',
      place: 'created-place-id',
      roles: ['role1', 'role2'],
      username: 'contact',
    });
    expect(place.isCreated).to.be.true;
  });

  it('#173 - replacement when place has no primary contact', async () => {
    const { subcounty, sessionCache, contactType, fakeFormData, chtApi } = await createMocks();
    const toReplace: ChtDoc = {
      _id: 'id-replace',
      name: 'to-replace',
    };

    chtApi.updatePlace.resolves({ _id: 'updated-place-id' });
    fakeFormData.hierarchy_replacement = toReplace.name;
    
    chtApi.getPlacesWithType
      .onFirstCall().resolves([])
      .onSecondCall().resolves([subcounty])
      .onThirdCall().resolves([toReplace]);

    const place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    console.log(place.validationErrors);
    expect(place.validationErrors).to.be.empty;

    const uploadManager = new UploadManager();
    await uploadManager.doUpload([place], chtApi);
    expect(chtApi.deleteDoc.callCount).to.eq(0);
    expect(chtApi.disableUser.callCount).to.eq(1);
    expect(place.isCreated).to.be.true;
  });
});

async function createMocks() {
  const contactType = mockValidContactType('string', undefined);
  const subcounty: ChtDoc = {
    _id: 'parent-id',
    name: 'parent-name',
  };
  const sessionCache = new SessionCache();
  const chtApi = {
    chtSession: mockChtSession(),
    getPlacesWithType: sinon.stub()
      .onFirstCall().resolves([])
      .onSecondCall().resolves([subcounty])
      .onThirdCall().resolves([]),
    // getPlacesWithType: sinon.stub().resolves([subcounty]),
    createPlace: sinon.stub().resolves({ placeId: 'created-place-id', contactId: 'created-contact-id' }),
    updateContactParent: sinon.stub().resolves('created-contact-id'),
    createUser: sinon.stub().resolves(),
    
    getParentAndSibling: sinon.stub().resolves({ parent: {}, sibling: {} }),
    getUsersAtPlace: sinon.stub().resolves([{
      username: 'user',
      place: [{ _id: 'id-replace' }]
    }]),
    disableUser: sinon.stub().resolves(),
    updateUser: sinon.stub().resolves(),
    createContact: sinon.stub().resolves('replacement-contact-id'),
    updatePlace: sinon.stub().resolves({
      _id: 'updated-place-id',
      user_attribution: {
        previousPrimaryContacts: ['prev_contact_id'],
      },
    }),
    deleteDoc: sinon.stub().resolves(),
  };
  
  const fakeFormData: any = {
    place_name: 'place',
    place_prop: 'foo',
    hierarchy_PARENT: subcounty.name,
    contact_name: 'contact'
  };

  return { fakeFormData, contactType, sessionCache, chtApi, subcounty };
}
