import _ from 'lodash';
import { expect } from 'chai';
import sinon from 'sinon';

import PlaceFactory from '../../src/services/place-factory';
import SessionCache from '../../src/services/session-cache';
import { ParentDetails } from '../../src/lib/cht-api';
import { mockParentPlace, mockProperty, mockValidContactType } from '../mocks';
import Place from '../../src/services/place';
import PlaceResolver from '../../src/lib/place-resolver';

describe('services/place-factory.ts', () => {
  it('name conflict at local yields invalid', async () => {
    const { parentContactType, sessionCache, fakeFormData, chtApi, createParentPlace } = mockScenario();
    sessionCache.savePlaces(createParentPlace(), createParentPlace());

    const place: Place = await PlaceFactory.createOne(fakeFormData, parentContactType, sessionCache, chtApi);
    expect(place.invalidProperties).to.deep.eq(['place_PARENT']);
    const parentHasCollision = !PlaceResolver.isParentIdValid(place.parentDetails?.id);
    expect(parentHasCollision).to.be.true;
  });

  it('name conflict at remote yields invalid', async () => {
    const { parentDetails, sessionCache, fakeFormData, contactType, chtApi } = mockScenario();
    const secondParent = _.cloneDeep(parentDetails);
    secondParent.id = 'second-id';
    chtApi.getPlacesWithType.resolves([parentDetails, secondParent]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.invalidProperties).to.deep.eq(['place_PARENT']);
    const parentHasCollision = !PlaceResolver.isParentIdValid(place.parentDetails?.id);
    expect(parentHasCollision).to.be.true;
  });

  it('parent match requiring local fuzz', async () => {
    const { parentDetails, sessionCache, fakeFormData, contactType, parentContactType, chtApi } = mockScenario();

    const chu = new Place(parentContactType);
    chu.properties.name = 'Demesi';
    sessionCache.savePlaces(chu);

    fakeFormData.place_PARENT = 'Demesi ';

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.invalidProperties).to.be.empty;
    expect(place.parentDetails.id).to.eq(chu.id);
  });

  it('bulk upload fuzzed parent matching', async () => {
    const { parentDetails, sessionCache, fakeFormData, chtApi } = mockScenario();

    const nameValidator = ['Cu', 'Community Health Unit'];
    const contactType = mockValidContactType('string', undefined);
    contactType.place_properties[0] = mockProperty('name', nameValidator, 'PARENT');

    parentDetails.name = 'Cheplanget Cu';
    fakeFormData.place_PARENT = 'Cheplanget Community Health Unit';

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.invalidProperties).to.be.empty;
    expect(place.parentDetails?.id).to.eq('parent-id');
  });

  it('simple replacement', async () => {
    const { parentDetails, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    fakeFormData.place_replacement = 'to-replace';

    const toReplace: ParentDetails = {
      id: 'id-replace',
      name: 'to-replace',
    };

    chtApi.getPlacesWithType
      .resolves([parentDetails])
      .onSecondCall()
      .resolves([toReplace]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.invalidProperties).to.be.empty;
    expect(place.parentDetails?.id).to.eq('parent-id');
    expect(place.replacement?.id).to.eq('id-replace');
  });

  it('ambiguous parent resolves if only one has the replacement', async () => {
    const { parentDetails, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    fakeFormData.place_replacement = 'to-replace';

    const toReplace: ParentDetails = {
      id: 'id-replace',
      name: 'to-replace',
    };
    const ambiguous = {
      ...parentDetails,
      id: 'id-parent-ambiguous',
    };

    chtApi.getDoc = sinon.stub().resolves({ parent: { _id: ambiguous.id } })
    chtApi.getPlacesWithType
      .resolves([parentDetails, ambiguous])
      .onSecondCall()
      .resolves([toReplace]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.invalidProperties).to.be.empty;
    expect(place.parentDetails?.id).to.eq('id-parent-ambiguous');
    expect(place.replacement?.id).to.eq('id-replace');
  });

  it('ambiguous place under single parent is invalid', async () => {
    const { parentDetails, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    fakeFormData.place_replacement = 'to-replace';

    const toReplace: ParentDetails = {
      id: 'id-replace',
      name: 'to-replace',
    };
    const ambiguous = {
      ...toReplace,
      id: 'id-replace-ambiguous',
    };

    chtApi.getPlacesWithType
      .resolves([parentDetails])
      .onSecondCall()
      .resolves([toReplace, ambiguous]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(chtApi.getPlacesWithType.args).to.deep.eq([['parent', undefined], ['contacttype-name', ['parent-id']]]);
    expect(place.invalidProperties).to.deep.eq(['place_replacement']);
    expect(place.parentDetails?.id).to.eq('parent-id');
    expect(place.replacement?.id).to.eq('multiple');
  });
});

function mockScenario() {
  const contactType = mockValidContactType('string', undefined);
  const parentDetails: ParentDetails = {
    id: 'parent-id',
    name: 'parent-name',
  };
  const sessionCache = new SessionCache();
  const chtApi = {
    getPlacesWithType: sinon.stub().resolves([parentDetails]),
    createPlace: sinon.stub().resolves('created-place-id'),
    getPlaceContactId: sinon.stub().resolves('created-contact-id'),
    updateContactParent: sinon.stub().resolves(),
    createUser: sinon.stub().resolves(),
  };
  const fakeFormData:any = {
    place_name: 'place',
    place_prop: 'foo',
    place_PARENT: parentDetails.name,
    contact_name: 'contact',
  };
  const createParentPlace = () => mockParentPlace(parentContactType, fakeFormData.place_PARENT);
  const parentContactType = mockValidContactType('string', undefined);
  parentContactType.name = contactType.parent_type;

  return { 
    parentDetails,
    createParentPlace,
    sessionCache,
    fakeFormData,
    parentContactType,
    contactType,
    chtApi
  };
}

