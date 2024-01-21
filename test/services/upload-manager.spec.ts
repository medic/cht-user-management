import _ from 'lodash';
import { expect } from 'chai';
import sinon from 'sinon';

import { UploadManager } from '../../src/services/upload-manager';
import { mockValidContactType, mockParentPlace, mockChtSession, expectInvalidProperties } from '../mocks';
import PlaceFactory from '../../src/services/place-factory';
import SessionCache from '../../src/services/session-cache';
import { ChtApi, RemotePlace } from '../../src/lib/cht-api';
import RemotePlaceCache from '../../src/lib/remote-place-cache';
import { Config } from '../../src/config';
import RemotePlaceResolver from '../../src/lib/remote-place-resolver';

describe('upload-manager.ts', () => {
  beforeEach(() => {
    RemotePlaceCache.clear({});
  });

  it('mock data is properly sent to chtApi', async () => {
    const { fakeFormData, contactType, chtApi, sessionCache, remotePlace } = await createMocks();
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
      parent: remotePlace.id,
      contact_type: contactType.name,
    });
    expect(chtApi.updateContactParent.calledOnce).to.be.true;
    expect(chtApi.updateContactParent.args[0]).to.deep.eq(['created-place-id']);

    expect(chtApi.createUser.calledOnce).to.be.true;
    const userPayload = chtApi.createUser.args[0][0];
    expect(userPayload).to.deep.include({
      contact: 'created-contact-id',
      place: 'created-place-id',
      type: 'role',
      username: 'contact',
    });
    expect(place.isCreated).to.be.true;
  });

  it('mock data is properly sent to chtApi (sessionCache cache)', async () => {
    const { fakeFormData, contactType, sessionCache, chtApi, remotePlace } = await createMocks();

    const parentContactType = mockValidContactType('string', undefined);
    parentContactType.name = remotePlace.name;

    const parentPlace = mockParentPlace(parentContactType, remotePlace.name);
    sessionCache.savePlaces(parentPlace);
    const place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    const uploadManager = new UploadManager();
    await uploadManager.doUpload([place], chtApi);

    expect(chtApi.getPlacesWithType.calledTwice).to.be.true;
    expect(chtApi.getPlacesWithType.args[0]).to.deep.eq(['parent']);
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
    const { remotePlace, sessionCache, contactType, fakeFormData, chtApi } = await createMocks();
    fakeFormData.hierarchy_replacement = 'to-replace';
    fakeFormData.place_prop = ''; // required during creation, but can be empty (ui) or undefined (csv)
    fakeFormData.place_name = undefined;

    const toReplace: RemotePlace = {
      id: 'id-replace',
      name: 'to-replace',
      lineage: [remotePlace.id],
      type: 'remote',
    };

    chtApi.getPlacesWithType
      .resolves([remotePlace])
      .onSecondCall()
      .resolves([toReplace]);

    const place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty; // only parent is required when replacing

    const uploadManager = new UploadManager();
    await uploadManager.doUpload([place], chtApi);
    expect(chtApi.updatePlace.calledOnce).to.be.true;
    expect(chtApi.updatePlace.args[0][0]).to.not.have.property('prop');
    expect(chtApi.updatePlace.args[0][0]).to.not.have.property('name');
    expect(place.isCreated).to.be.true;
  });

  it('contact_type replacement with username_from_place:true', async () => {
    const { remotePlace, sessionCache, contactType, fakeFormData, chtApi } = await createMocks();
    contactType.username_from_place = true;

    fakeFormData.hierarchy_replacement = 'replacement based username';
    fakeFormData.place_name = ''; // optional due to replacement

    const toReplace: RemotePlace = {
      id: 'id-replace',
      name: 'replac"e$mENT baSed username',
      lineage: [remotePlace.id],
      type: 'remote',
    };

    chtApi.getPlacesWithType
      .resolves([remotePlace])
      .onSecondCall()
      .resolves([toReplace]);

    const place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty; // only parent is required when replacing

    const uploadManager = new UploadManager();
    await uploadManager.doUpload([place], chtApi);
    expect(chtApi.createUser.args[0][0]).to.deep.include({
      username: 'replacement_based_username',
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
    const { remotePlace, sessionCache, chtApi } = await createMocks();

    chtApi.getPlacesWithType
      .resolves([])                             // parent of chp
      .onSecondCall().resolves([remotePlace])   // grandparent of chp (subcounty)
      .onThirdCall().resolves([]);              // chp replacements

    const chu_name = 'new chu';
    const chpType = Config.getContactType('d_community_health_volunteer_area');
    const chpData = {
      hierarchy_CHU: chu_name,
      place_name: 'new chp',
      contact_name: 'new chp',
      contact_phone: '0788889999',
    };

    // CHP has validation errors because it references a CHU which does not exist
    const chp = await PlaceFactory.createOne(chpData, chpType, sessionCache, chtApi);
    expectInvalidProperties(chp.validationErrors, ['hierarchy_CHU'], 'Cannot find');

    const chu = await createChu(remotePlace, chu_name, sessionCache, chtApi);

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
    expect(chtApi.createUser.args[0][0].type).to.eq('community_health_assistant');
    expect(chtApi.createUser.args[1][0].type).to.eq('community_health_volunteer');

    const cachedChus = await RemotePlaceCache.getPlacesWithType(chtApi, chu.type.name);
    expect(cachedChus).to.have.property('length', 1);
    const cachedChps = await RemotePlaceCache.getPlacesWithType(chtApi, chp.type.name);
    expect(cachedChps).to.have.property('length', 1);
  });

  it('failure to upload', async () => {
    const { remotePlace, sessionCache, chtApi } = await createMocks();

    chtApi.createUser
      .throws('timeout')
      .onSecondCall().resolves();

    const chu_name = 'new chu';
    const chu = await createChu(remotePlace, chu_name, sessionCache, chtApi);

    const uploadManager = new UploadManager();
    await uploadManager.doUpload(sessionCache.getPlaces(), chtApi);
    expect(chu.isCreated).to.be.false;
    expect(chu.uploadError).to.include('timeout');
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
    expect(chtApi.updateContactParent.callCount).to.eq(1);
    expect(chtApi.createUser.callCount).to.eq(2);
    expect(chtApi.getParentAndSibling.called).to.be.false;
    expect(chtApi.createContact.called).to.be.false;
    expect(chtApi.updatePlace.called).to.be.false;
    expect(chtApi.disableUsersWithPlace.called).to.be.false;
  });
});

async function createChu(remotePlace: RemotePlace, chu_name: string, sessionCache: any, chtApi: ChtApi) {
  const chuType = Config.getContactType('c_community_health_unit');
  const chuData = {
    hierarchy_SUBCOUNTY: remotePlace.name,
    place_name: chu_name,
    place_code: '676767',
    place_link_facility_name: 'facility name',
    place_link_facility_code: '23456',
    contact_name: 'new cha',
    contact_phone: '0712345678',
  };
  const chu = await PlaceFactory.createOne(chuData, chuType, sessionCache, chtApi);
  expect(chu.validationErrors).to.be.empty;
  return chu;
}

async function createMocks() {
  const contactType = mockValidContactType('string', undefined);
  const remotePlace: RemotePlace = {
    id: 'parent-id',
    name: 'parent-name',
    type: 'remote',
    lineage: [],
  };
  const sessionCache = new SessionCache();
  const chtApi = {
    chtSession: mockChtSession(),
    getPlacesWithType: sinon.stub().resolves([remotePlace]),
    createPlace: sinon.stub().resolves('created-place-id'),
    updateContactParent: sinon.stub().resolves('created-contact-id'),
    createUser: sinon.stub().resolves(),

    getParentAndSibling: sinon.stub().resolves({ parent: {}, sibling: {} }),
    createContact: sinon.stub().resolves('replacement-contact-id'),
    updatePlace: sinon.stub().resolves('updated-place-id'),
    disableUsersWithPlace: sinon.stub().resolves(['org.couchdb.user:disabled']),
  };
  
  const fakeFormData: any = {
    place_name: 'place',
    place_prop: 'foo',
    hierarchy_PARENT: remotePlace.name,
    contact_name: 'contact',
  };

  return { fakeFormData, contactType, sessionCache, chtApi, remotePlace };
}

