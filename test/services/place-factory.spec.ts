import _ from 'lodash';
import { expect } from 'chai';
import sinon from 'sinon';

import PlaceFactory from '../../src/services/place-factory';
import SessionCache from '../../src/services/session-cache';
import { ParentDetails } from '../../src/lib/cht-api';
import { mockValidContactType } from '../mocks';
import Place from '../../src/services/place';
import ParentComparator from '../../src/lib/parent-comparator';

describe('services/place-factory.ts', () => {
  it('name conflict local and (unknown) remote yields valid', async () => {
    const { parentDetails, sessionCache, fakeFormData, contactType, chtApi } = mockScenario();
    const secondParent = _.cloneDeep(parentDetails);
    secondParent.id = 'second';

    // cht-api yields first, session-cache yields second
    sessionCache.saveKnownParents(secondParent);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.invalidProperties).to.be.empty;
    const parentHasCollision = !ParentComparator.isParentIdValid(place.parentDetails?.id);
    expect(parentHasCollision).to.be.false;
  });

  it('name conflict at local yields invalid', async () => {
    const { parentDetails, sessionCache, fakeFormData, contactType, chtApi } = mockScenario();
    const secondParent = _.cloneDeep(parentDetails);
    secondParent.id = 'second';
    sessionCache.saveKnownParents(parentDetails, secondParent);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.invalidProperties).to.deep.eq(['place_PARENT']);
    const parentHasCollision = !ParentComparator.isParentIdValid(place.parentDetails?.id);
    expect(parentHasCollision).to.be.true;
  });

  it('name conflict at remote yields invalid', async () => {
    const { parentDetails, sessionCache, fakeFormData, contactType, chtApi } = mockScenario();
    const secondParent = _.cloneDeep(parentDetails);
    chtApi.searchPlace.resolves([parentDetails, secondParent]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.invalidProperties).to.deep.eq(['place_PARENT']);
    const parentHasCollision = !ParentComparator.isParentIdValid(place.parentDetails?.id);
    expect(parentHasCollision).to.be.true;
  });
});

function mockScenario() {
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
  return { parentDetails, sessionCache, fakeFormData, contactType, chtApi };
}

