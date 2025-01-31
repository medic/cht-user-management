import _ from 'lodash';
import Chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import fs from 'fs';
import sinon from 'sinon';

import { ChtDoc, expectInvalidProperties, mockChtSession, mockParentPlace, mockProperty, mockValidContactType } from '../mocks';
import { Config } from '../../src/config';
import Place from '../../src/services/place';
import PlaceFactory from '../../src/services/place-factory';
import RemotePlaceCache from '../../src/lib/remote-place-cache';
import RemotePlaceResolver from '../../src/lib/remote-place-resolver';
import SessionCache from '../../src/services/session-cache';
import { UnvalidatedPropertyValue } from '../../src/property-value';

Chai.use(chaiAsPromised);

const { expect } = Chai;

describe('services/place-factory.ts', () => {
  beforeEach(() => {
    RemotePlaceCache.clear({});
  });

  it('name conflict at local yields invalid', async () => {
    const { parentContactType, sessionCache, fakeFormData, chtApi } = mockScenario();
    const parent1 = mockParentPlace(parentContactType, fakeFormData.hierarchy_PARENT);
    const parent2 = mockParentPlace(parentContactType, fakeFormData.hierarchy_PARENT);
    sessionCache.savePlaces(parent1, parent2);

    const place: Place = await PlaceFactory.createOne(fakeFormData, parentContactType, sessionCache, chtApi);
    expectInvalidProperties(place.validationErrors, ['hierarchy_PARENT'], 'multiple');
  });

  it('name conflict at remote yields invalid', async () => {
    const { parentDoc, sessionCache, fakeFormData, contactType, chtApi } = mockScenario();
    const secondParent = _.cloneDeep(parentDoc);
    secondParent._id = 'second-id';
    chtApi.getPlacesWithType.onSecondCall().resolves([parentDoc, secondParent]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expectInvalidProperties(place.validationErrors, ['hierarchy_PARENT'], 'multiple');
  });

  it('parent match requiring local fuzz', async () => {
    const { sessionCache, fakeFormData, contactType, parentContactType, chtApi } = mockScenario();

    const chu = new Place(parentContactType);
    chu.properties.name = new UnvalidatedPropertyValue('Demesi', 'name');
    sessionCache.savePlaces(chu);

    fakeFormData.hierarchy_PARENT = 'Demesi ';

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty;
    expect(place.resolvedHierarchy[1]?.id).to.eq(chu.id);
    expect(place.hierarchyProperties.PARENT.formatted).to.eq('Demesi');
  });

  it('bulk upload fuzzed parent matching', async () => {
    const { parentDoc, sessionCache, fakeFormData, chtApi } = mockScenario();

    const contactType = mockValidContactType('string', undefined);
    const nameValidatorParameter = ['Cu', 'Community Health Unit'];
    contactType.hierarchy[0] = {
      ...mockProperty('name', nameValidatorParameter, 'PARENT'),
      level: 1,
      contact_type: 'parent',
    };

    parentDoc.name = 'Cheplanget Cu';
    fakeFormData.hierarchy_PARENT = 'Cheplanget Community Health Unit';

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);

    expect(place.validationErrors).to.be.empty;
    expect(place.resolvedHierarchy[1]?.id).to.eq('parent-id');
  });

  it('simple replacement', async () => {
    const { parentDoc, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    fakeFormData.hierarchy_replacement = 'to-replace';

    const toReplace: ChtDoc = {
      _id: 'id-replace',
      name: 'to-replace',
      parent: { _id: parentDoc._id },
    };

    chtApi.getPlacesWithType
      .onFirstCall().resolves([])
      .onSecondCall().resolves([parentDoc])
      .onThirdCall().resolves([toReplace]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty;
    expect(place.resolvedHierarchy[1]?.id).to.eq('parent-id');
    expect(place.resolvedHierarchy[0]?.id).to.eq('id-replace');
  });

  it('invalid when name doesnt match any remote place', async () => {
    const { parentDoc, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    parentDoc.name = 'foobar';
    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expectInvalidProperties(place.validationErrors, ['hierarchy_PARENT'], 'Cannot find');
  });

  it('simple eCHIS csv', async () => {
    const { parentDoc, sessionCache, chtApi } = mockScenario();

    const toReplace: ChtDoc = {
      _id: 'id-replace',
      name: 'bob',
      parent: { _id: parentDoc._id },
      contact: { _id: 'replace-contact' },
    };

    parentDoc.name = 'Chepalungu CHU';

    chtApi.getPlacesWithType
      .onFirstCall().resolves([])
      .onSecondCall().resolves([parentDoc])
      .onThirdCall().resolves([toReplace]);

    const singleCsvBuffer = fs.readFileSync('./test/single-replace.csv');
    const chpType = Config.getContactType('d_community_health_volunteer_area');
    
    const places: Place[] = await PlaceFactory.createFromCsv(singleCsvBuffer, chpType, sessionCache, chtApi);
    expect(places).to.have.property('length', 1);

    const [successfulPlace] = places;
    expect(successfulPlace).to.deep.nested.include({
      name: 'Sally Area',
      'contact.properties.name.formatted': 'Sally',
      'contact.properties.phone.formatted': '0712 345678',
      creationDetails: {},
      'properties.name.formatted': 'Sally Area',
      'hierarchyProperties.CHU.original': 'chepalungu',
      'hierarchyProperties.CHU.formatted': 'Chepalungu',
      resolvedHierarchy: [
        {
          id: 'id-replace',
          name: {
            formatted: 'Bob',
            original: 'bob',
            propertyNameWithPrefix: 'place_replacement',
          },
          lineage: ['parent-id'],
          placeType: 'd_community_health_volunteer_area',
          type: 'remote',
          uniquePlaceValues: {
            name: {
              original: 'bob',
              formatted: 'bob',
              propertyNameWithPrefix: 'place_name',
            }
          },
          contactId: 'replace-contact',
        },
        {
          id: 'parent-id',
          name: {
            formatted: 'Chepalungu',
            original: parentDoc.name,
            propertyNameWithPrefix: 'place_CHU',
          },
          type: 'remote',
          lineage: [],
          placeType: 'c_community_health_unit',
          uniquePlaceValues: {
            name: {
              original: 'Chepalungu CHU',
              formatted: 'Chepalungu',
              propertyNameWithPrefix: 'place_name',
            }
          },
          contactId: 'parent-contact',
        },
      ],
      validationErrors: {},
      userRoleProperties: {},
      state: 'staged',
      warnings: [],
    });
  });

  it('ambiguous parent resolves if only one has the replacement', async () => {
    const { parentDoc, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    
    const toReplace: ChtDoc = {
      _id: 'id-replace',
      name: 'to-replace',
      parent: { _id: parentDoc._id },
    };
    fakeFormData.hierarchy_replacement = toReplace.name;

    const ambiguous = {
      ...parentDoc,
      _id: 'id-parent-ambiguous',
    };

    chtApi.getPlacesWithType
      .onFirstCall().resolves([])
      .onSecondCall().resolves([parentDoc, ambiguous])
      .onThirdCall().resolves([toReplace]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty;
    expect(place.resolvedHierarchy[1]?.id).to.eq('parent-id');
    expect(place.resolvedHierarchy[0]?.id).to.eq('id-replace');
  });

  it('ambiguous greatgrandparent disambiguated by parent', async () => {
    const { parentDoc, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();

    const greatParent: ChtDoc = {
      _id: 'id-great-grandparent',
      name: 'great-grand-parent',
    };
    contactType.hierarchy[1] = {
      ...mockProperty('name', undefined, 'GREATGRANDPARENT'),
      level: 3,
      contact_type: 'greatgrandparent',
      required: false,
    };
    fakeFormData.hierarchy_GREATGRANDPARENT = greatParent.name;
    parentDoc.parent = { /*_id: ?,*/ parent: { _id: greatParent._id } };

    const ambiguous: ChtDoc = {
      ...greatParent,
      _id: 'ambiguous-great-grandparent',
    };

    chtApi.getPlacesWithType
      .onFirstCall().resolves([greatParent, ambiguous])
      .onSecondCall().resolves([parentDoc, ])
      .onThirdCall().resolves([]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty;
    expect(place.resolvedHierarchy[3]?.id).to.eq(greatParent._id);
    expect(place.resolvedHierarchy[1]?.id).to.eq(parentDoc._id);
  });

  it('ambiguous parent disambiguated by grandparent', async () => {
    const { parentDoc, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    
    const grandParent: ChtDoc = {
      _id: 'id-grandparent',
      name: 'grand-parent',
    };
    fakeFormData.hierarchy_GRANDPARENT = grandParent.name;
    
    const ambiguous: ChtDoc = {
      ...parentDoc,
      _id: 'id-ambiguous',
    };
    parentDoc.parent = { _id: grandParent._id };
    ambiguous.parent = { _id: 'not-grandpa' };

    chtApi.getPlacesWithType
      .onFirstCall().resolves([grandParent])
      .onSecondCall().resolves([parentDoc, ambiguous])
      .onThirdCall().resolves([]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty;
    const resolvedHierarchyIds = place.resolvedHierarchy.map(h => h?.id);
    expect(resolvedHierarchyIds).to.deep.eq([undefined, parentDoc._id, grandParent._id]);
  });

  it('#91 - no result for optional level in hierarchy causes validation error', async () => {
    const { parentDoc, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    
    const grandParent: ChtDoc = {
      _id: 'id-grandparent',
      name: 'grand-parent',
    };
    parentDoc.parent = { _id: grandParent._id };
    fakeFormData.hierarchy_GRANDPARENT = 'no match';

    chtApi.getPlacesWithType
      .onFirstCall().resolves([grandParent])
      .onSecondCall().resolves([parentDoc])
      .onThirdCall().resolves([]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.resolvedHierarchy[2]).to.eq(RemotePlaceResolver.NoResult);
    expectInvalidProperties(place.validationErrors, ['hierarchy_PARENT', 'hierarchy_GRANDPARENT'], 'Cannot find');
  });

  it('hierarchy resolution can be resolved by editing to blank', async () => {
    const { parentDoc, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    
    const grandParent: ChtDoc = {
      _id: 'id-grandparent',
      name: 'grand-parent',
    };
    parentDoc.parent = { _id: grandParent._id };
    fakeFormData.hierarchy_GRANDPARENT = 'no match';

    chtApi.getPlacesWithType
      .onFirstCall().resolves([grandParent])
      .onSecondCall().resolves([parentDoc])
      .onThirdCall().resolves([]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expectInvalidProperties(place.validationErrors, ['hierarchy_PARENT', 'hierarchy_GRANDPARENT'], 'Cannot find');

    fakeFormData.hierarchy_GRANDPARENT = '';
    const edited = await PlaceFactory.editOne(place.id, fakeFormData, sessionCache, chtApi);
    expect(edited.validationErrors).to.be.empty;
  });

  it('ambiguous parent disambiguated by greatgrandparent', async () => {
    const { parentDoc, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    
    const greatParent: ChtDoc = {
      _id: 'id-great-grandparent',
      name: 'great-grand-parent',
    };
    contactType.hierarchy[1] = {
      ...mockProperty('name', undefined, 'GREATGRANDPARENT'),
      level: 3,
      contact_type: 'greatgrandparent',
      required: false,
    };
    fakeFormData.hierarchy_GREATGRANDPARENT = greatParent.name;
    
    const ambiguous: ChtDoc = {
      ...parentDoc,
      _id: 'id-ambiguous',
    };
    parentDoc.parent = { _id: 'no-matter', parent: { _id: greatParent._id } };
    ambiguous.parent = { _id: 'not-grandpa', parent: { _id: 'not-grandpa' } };

    chtApi.getPlacesWithType
      .onFirstCall().resolves([greatParent])
      .onSecondCall().resolves([parentDoc, ambiguous])
      .onThirdCall().resolves([]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty;
    const resolvedHierarchyIds = place.resolvedHierarchy.map(h => h?.id);
    expect(resolvedHierarchyIds).to.deep.eq([undefined, parentDoc._id, undefined, greatParent._id]);
  });

  it('ambiguous place under single parent is invalid', async () => {
    const { parentDoc, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    fakeFormData.hierarchy_replacement = 'to-replace';

    const toReplace: ChtDoc = {
      _id: 'id-replace',
      name: 'to-replace',
    };
    const ambiguous: ChtDoc = {
      ...toReplace,
      _id: 'id-replace-ambiguous',
      parentId: parentDoc._id,
    };

    chtApi.getPlacesWithType
      .onFirstCall().resolves([])
      .onSecondCall().resolves([parentDoc])
      .onThirdCall().resolves([toReplace, ambiguous]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(chtApi.getPlacesWithType.args).to.deep.eq([['grandparent'], ['parent'], ['contacttype-name']]);
    expectInvalidProperties(place.validationErrors, ['hierarchy_replacement'], 'multiple');
    expect(place.resolvedHierarchy[1]?.id).to.eq('parent-id');
    expect(place.resolvedHierarchy[0]?.id).to.eq('multiple');
  });

  it('replacement place not under parent is invalid', async () => {
    const { parentDoc, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    
    const toReplace: ChtDoc = {
      _id: 'id-replace',
      name: 'to-replace',
      parent: { _id: 'different-parent' },
    };
    fakeFormData.hierarchy_replacement = toReplace.name;
    chtApi.getPlacesWithType
      .onFirstCall().resolves([])
      .onSecondCall().resolves([parentDoc])
      .onThirdCall().resolves([toReplace]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expectInvalidProperties(place.validationErrors, ['hierarchy_replacement'], 'Cannot find');
    expect(place.resolvedHierarchy[1]?.id).to.eq('parent-id');
    expect(place.resolvedHierarchy[0]).to.eq(RemotePlaceResolver.NoResult);
  });
  
  it('place not under users facility is invalid', async () => {
    const { parentDoc, sessionCache, contactType, parentContactType, fakeFormData, chtApi } = mockScenario();
    const parent1 = mockParentPlace(parentContactType, fakeFormData.hierarchy_PARENT);
    chtApi.getPlacesWithType.resolves([parentDoc]);
    chtApi.chtSession = mockChtSession('other');
    fakeFormData.hierarchy_PARENT = parent1.name;

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expectInvalidProperties(place.validationErrors, ['hierarchy_PARENT'], 'Cannot find');
  });

  it('#124 - testing replacement when place.name is generated', async () => {
    const { parentDoc, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    fakeFormData.hierarchy_replacement = 'dne';

    contactType.place_properties[0] = {
      friendly_name: '124',
      property_name: 'name',
      type: 'generated',
      required: true,
      parameter: '{{contact.name}} Area',
    };

    const otherPlace: ChtDoc = {
      _id: 'other-place',
      name: 'other-place',
      parent: { _id: parentDoc._id },
    };
    const toReplace: ChtDoc = {
      _id: 'id-replace',
      name: 'to-replace',
      parent: { _id: parentDoc._id },
    };

    chtApi.getPlacesWithType
      .onFirstCall().resolves([])
      .onSecondCall().resolves([parentDoc])
      .onThirdCall().resolves([toReplace, otherPlace]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expectInvalidProperties(place.validationErrors, ['hierarchy_replacement'], 'Cannot find');
  });

  it('#124 - replacement_property is used for fuzzing during replacement', async () => {
    const { parentDoc, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    fakeFormData.hierarchy_replacement = 'to-replace';

    contactType.replacement_property = {
      friendly_name: 'Outgoing CHP',
      property_name: 'replacement',
      type: 'name',
      parameter: ['\\sArea', '\\s\\(.*\\)'],
      required: true
    };

    const toReplace: ChtDoc = {
      _id: 'id-replace',
      name: 'to-replace Area (village)',
      parent: { _id: parentDoc._id },
    };

    chtApi.getPlacesWithType
      .onFirstCall().resolves([])
      .onSecondCall().resolves([parentDoc])
      .onThirdCall().resolves([toReplace]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty;
    expect(place.resolvedHierarchy[1]?.id).to.eq('parent-id');
    expect(place.resolvedHierarchy[0]?.id).to.eq('id-replace');
  });

  it('assertion if data for a required level is totally missing', async () => {
    const { sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    delete fakeFormData.hierarchy_PARENT;

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expectInvalidProperties(place.validationErrors, ['hierarchy_PARENT'], 'is empty');
  });

  it('create a place even if generated property is required', async () => {
    const { sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    contactType.place_properties[0] = {
      friendly_name: 'CHP Area Name',
      property_name: 'name',
      type: 'generated',
      parameter: '{{ contact.name }} Area',
      required: true
    };
    delete fakeFormData.place_name;

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty;
  });

  it('fail to create a place with missing generated property which is required', async () => {
    const { sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    contactType.place_properties[0] = {
      friendly_name: 'CHP Area Name',
      property_name: 'name',
      type: 'generated',
      parameter: '{{ contact.dne }}',
      required: true
    };
    delete fakeFormData.place_name;

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expectInvalidProperties(place.validationErrors, ['place_name'], 'Required');
  });
});

it('#165 - create a place when generated property is required', async () => {
  const { sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
  contactType.place_properties[0] = {
    friendly_name: 'CHP Area Name',
    property_name: 'name',
    type: 'generated',
    parameter: '{{ contact.name }} Area',
    required: true
  };
  delete fakeFormData.place_name;

  const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
  expect(place.validationErrors).to.be.empty;
});

function mockScenario() {
  const contactType = mockValidContactType('string', undefined);
  const parentDoc: ChtDoc = {
    _id: 'parent-id',
    name: 'parent-name',
    contact: 'parent-contact',
  };
  const sessionCache = new SessionCache();
  const chtApi = {
    chtSession: mockChtSession(),
    getPlacesWithType: sinon.stub()
      .onFirstCall().resolves([])
      .onSecondCall().resolves([parentDoc])
      .onThirdCall().resolves([]),
    createPlace: sinon.stub().resolves({ placeId: 'created-place-id', contactId: 'created-contact-id' }),
    createUser: sinon.stub().resolves(),
  };
  const fakeFormData:any = {
    place_name: 'place',
    place_prop: 'foo',
    hierarchy_PARENT: parentDoc.name,
    contact_name: 'contact',
  };
  const parentContactType = mockValidContactType('string', undefined);
  parentContactType.name = contactType.hierarchy[0].contact_type;

  return { 
    parentDoc,
    sessionCache,
    fakeFormData,
    parentContactType,
    contactType,
    chtApi
  };
}

