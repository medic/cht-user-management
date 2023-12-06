import { expect } from 'chai';
import sinon from 'sinon';

import { UploadManager } from '../../src/services/upload-manager';
import { mockValidContactType } from '../mocks';
import PlaceFactory from '../../src/services/place-factory';
import SessionCache from '../../src/services/session-cache';
import { ParentDetails } from '../../src/lib/cht-api';

describe('upload-manager.ts', () => {
  it('mock data is properly sent to chtApi (no sessionCache cache)', async () => {
    const { fakeFormData, contactType, chtApi, sessionCache, parentDetails } = await createMocks();
    const place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);

    const uploadManager = new UploadManager();
    await uploadManager.doUpload([place], chtApi);

    expect(chtApi.createPlace.calledOnce).to.be.true;
    const placePayload = chtApi.createPlace.args[0][0];
    expect(placePayload).to.nested.include({
      'contact.contact_type': contactType.contact_type,
      'contact.name': 'contact',
      prop: 'foo',
      name: 'place',
      parent: parentDetails.id,
      contact_type: contactType.name,
    });
    expect(chtApi.getPlaceContactId.calledOnce).to.be.true;
    expect(chtApi.getPlaceContactId.args[0]).to.deep.eq(['created-place-id']);

    expect(chtApi.updateContactParent.calledOnce).to.be.true;
    expect(chtApi.updateContactParent.args[0]).to.deep.eq(['created-contact-id', 'created-place-id']);

    expect(chtApi.createUser.calledOnce).to.be.true;
    const userPayload = chtApi.createUser.args[0][0];
    expect(userPayload).to.deep.include({
      contact: 'created-contact-id',
      place: 'created-place-id',
      type: 'role',
      username: 'contact',
    });
  });

  it('mock data is properly sent to chtApi (sessionCache cache)', async () => {
    const { fakeFormData, contactType, sessionCache, chtApi, parentDetails } = await createMocks();
    sessionCache.saveKnownParents(parentDetails);
    const place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    const uploadManager = new UploadManager();
    await uploadManager.doUpload([place], chtApi);

    expect(chtApi.searchPlace.called).to.be.false;
  });
});

async function createMocks() {
  const contactType = mockValidContactType('string', undefined);
  const parentDetails: ParentDetails = {
    id: 'parent-id',
    type: contactType.parent_type,
    name: 'parent-name',
  };
  const sessionCache = new SessionCache();
  const chtApi = {
    searchPlace: sinon.stub().resolves([parentDetails]),
    createPlace: sinon.stub().resolves('created-place-id'),
    getPlaceContactId: sinon.stub().resolves('created-contact-id'),
    updateContactParent: sinon.stub().resolves(),
    createUser: sinon.stub().resolves(),
  };
  const fakeFormData = {
    place_name: 'place',
    place_prop: 'foo',
    place_PARENT: parentDetails.name,
    contact_name: 'contact',
  };

  return { fakeFormData, contactType, sessionCache, chtApi, parentDetails };
}

