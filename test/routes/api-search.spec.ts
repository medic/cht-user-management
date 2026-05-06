import { expect } from 'chai';
import Fastify, { FastifyInstance } from 'fastify';
import sinon from 'sinon';

import apiSearch from '../../src/routes/api-search';
import { Config } from '../../src/config';
import RemotePlaceCache, { RemotePlace } from '../../src/lib/remote-place-cache';
import RemotePlaceResolver from '../../src/lib/remote-place-resolver';
import PlaceFactory from '../../src/services/place-factory';
import Place from '../../src/services/place';
import { UnvalidatedPropertyValue } from '../../src/property-value';
import { mockChtSession, mockValidContactType } from '../mocks';

const PARENT_ID = 'parent-1';

function fakePlace(id: string, name: string, parentId: string = PARENT_ID): RemotePlace {
  return {
    id,
    name: new UnvalidatedPropertyValue(name),
    placeType: 'contacttype-name',
    lineage: [parentId],
    uniquePlaceValues: {},
    type: 'remote',
  };
}

function fakeParent(id: string): RemotePlace {
  return {
    id,
    name: new UnvalidatedPropertyValue('parent'),
    placeType: 'parent',
    lineage: [],
    uniquePlaceValues: {},
    type: 'remote',
  };
}

describe('routes/api-search.ts', () => {
  let fastify: FastifyInstance;
  let placeFactoryStub: sinon.SinonStub;
  let resolveStub: sinon.SinonStub;
  let getRemotePlacesStub: sinon.SinonStub;

  beforeEach(async () => {
    fastify = Fastify();
    fastify.addHook('preHandler', async (req) => {
      (req as any).chtSession = mockChtSession();
      (req as any).sessionCache = {} as any;
    });
    await fastify.register(apiSearch);

    sinon.stub(Config, 'getContactType').returns(mockValidContactType('string', undefined));

    // PlaceFactory.createOne returns a stub Place; resolveOne fills its
    // resolvedHierarchy on a per-test basis via callsFake further down.
    placeFactoryStub = sinon.stub(PlaceFactory, 'createOne').callsFake(async () => {
      return { resolvedHierarchy: [] } as unknown as Place;
    });
    resolveStub = sinon.stub(RemotePlaceResolver, 'resolveOne').resolves();
    getRemotePlacesStub = sinon.stub(RemotePlaceCache, 'getRemotePlaces').resolves([]);
  });

  afterEach(async () => {
    sinon.restore();
    await fastify.close();
  });

  it('returns places of the requested type under the resolved parent, ranked best-match first', async () => {
    resolveStub.callsFake(async (place: any) => {
      place.resolvedHierarchy[1] = fakeParent(PARENT_ID);
    });
    getRemotePlacesStub.resolves([
      fakePlace('p-jane', 'Jane Doe'),
      fakePlace('p-janet', 'Janet Doe'),
      fakePlace('p-other', 'Jane Doe', 'other-parent'),
    ]);

    const resp = await fastify.inject({
      method: 'POST',
      url: '/api/v1/search?type=anything',
      payload: { PARENT: 'parent', replacement: 'Jane Doe' },
    });

    expect(resp.statusCode).to.equal(200);
    const hits = resp.json();
    expect(hits.map((h: any) => h.uuid)).to.deep.equal(['p-jane', 'p-janet']);
    expect(hits[0].name).to.equal('Jane Doe');
    expect(hits[0].score).to.be.lessThan(hits[1].score); // lower fuse score = better match
  });

  it('reports a missing parent in the body when no resolved place is found', async () => {
    resolveStub.callsFake(async (place: any) => {
      place.resolvedHierarchy[1] = RemotePlaceResolver.NoResult;
    });

    const resp = await fastify.inject({
      method: 'POST',
      url: '/api/v1/search?type=anything',
      payload: { PARENT: 'wrong', replacement: 'Jane Doe' },
    });

    expect(resp.statusCode).to.equal(200);
    expect(resp.json()).to.deep.equal({
      error: 'hierarchy cannot be resolved: index 1 - Place Not Found',
      parentMissing: true,
      isAmbiguous: false,
    });
  });

  it('reports an ambiguous parent in the body when multiple places match', async () => {
    resolveStub.callsFake(async (place: any) => {
      place.resolvedHierarchy[1] = RemotePlaceResolver.Multiple;
    });

    const resp = await fastify.inject({
      method: 'POST',
      url: '/api/v1/search?type=anything',
      payload: { PARENT: 'ambiguous', replacement: 'Jane Doe' },
    });

    expect(resp.statusCode).to.equal(200);
    expect(resp.json()).to.deep.equal({
      error: 'hierarchy cannot be resolved: index 1 - multiple places',
      parentMissing: false,
      isAmbiguous: true,
    });
  });

  it('returns empty when no places of the requested type share the resolved parent', async () => {
    resolveStub.callsFake(async (place: any) => {
      place.resolvedHierarchy[1] = fakeParent(PARENT_ID);
    });
    getRemotePlacesStub.resolves([fakePlace('p-elsewhere', 'Jane Doe', 'other-parent')]);

    const resp = await fastify.inject({
      method: 'POST',
      url: '/api/v1/search?type=anything',
      payload: { PARENT: 'parent', replacement: 'Jane Doe' },
    });

    expect(resp.statusCode).to.equal(200);
    expect(resp.json()).to.deep.equal([]);
  });

  it('only forwards parent hierarchy fields to PlaceFactory (drops leaf and unrelated keys)', async () => {
    resolveStub.callsFake(async (place: any) => {
      place.resolvedHierarchy[1] = fakeParent(PARENT_ID);
    });
    getRemotePlacesStub.resolves([fakePlace('p-jane', 'Jane Doe')]);

    await fastify.inject({
      method: 'POST',
      url: '/api/v1/search?type=anything',
      payload: { PARENT: 'p', GRANDPARENT: 'gp', replacement: 'Jane Doe', UNRELATED: 'noise' },
    });

    expect(placeFactoryStub.calledOnce).to.be.true;
    const dataPassed = placeFactoryStub.firstCall.args[0];
    expect(dataPassed).to.deep.equal({ PARENT: 'p', GRANDPARENT: 'gp' });
    expect(dataPassed).to.not.have.property('replacement');
    expect(dataPassed).to.not.have.property('UNRELATED');
  });

  it('honours the query threshold by tightening Fuse cutoff', async () => {
    resolveStub.callsFake(async (place: any) => {
      place.resolvedHierarchy[1] = fakeParent(PARENT_ID);
    });
    getRemotePlacesStub.resolves([
      fakePlace('p-jane', 'Jane Doe'),
      fakePlace('p-totally', 'Totally Different XYZ'),
    ]);

    const resp = await fastify.inject({
      method: 'POST',
      url: '/api/v1/search?type=anything&threshold=0.1',
      payload: { PARENT: 'parent', replacement: 'Jane Doe' },
    });

    expect(resp.statusCode).to.equal(200);
    const hits = resp.json();
    expect(hits.map((h: any) => h.uuid)).to.deep.equal(['p-jane']);
  });

  it('returns 500 when type is unknown', async () => {
    (Config.getContactType as sinon.SinonStub).restore();
    sinon.stub(Config, 'getContactType').throws(new Error('unrecognized contact type: "bogus"'));

    const resp = await fastify.inject({
      method: 'POST',
      url: '/api/v1/search?type=bogus',
      payload: { replacement: 'Jane' },
    });

    expect(resp.statusCode).to.equal(500);
    expect(resp.json().message).to.contain('unrecognized contact type');
  });
});
