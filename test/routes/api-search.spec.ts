import { expect } from 'chai';
import Fastify, { FastifyInstance } from 'fastify';
import sinon from 'sinon';

import apiSearch from '../../src/routes/api-search';
import SearchLib from '../../src/lib/search';
import { Config } from '../../src/config';
import { RemotePlace } from '../../src/lib/remote-place-cache';
import { UnvalidatedPropertyValue } from '../../src/property-value';
import { mockChtSession, mockValidContactType } from '../mocks';

function fakeRemotePlace(id: string, name: string): RemotePlace {
  return {
    id,
    name: new UnvalidatedPropertyValue(name),
    placeType: 'contacttype-name',
    lineage: [],
    uniquePlaceValues: {},
    type: 'remote',
  };
}

describe('routes/api-search.ts', () => {
  let fastify: FastifyInstance;
  let searchStub: sinon.SinonStub;

  beforeEach(async () => {
    fastify = Fastify();
    fastify.addHook('preHandler', async (req) => {
      (req as any).chtSession = mockChtSession();
      (req as any).sessionCache = {} as any;
    });
    await fastify.register(apiSearch);

    sinon.stub(Config, 'getContactType').returns(mockValidContactType('string', undefined));
    searchStub = sinon.stub(SearchLib, 'search');
  });

  afterEach(async () => {
    sinon.restore();
    await fastify.close();
  });

  it('returns hits ranked by descending threshold', async () => {
    searchStub.resolves([
      fakeRemotePlace('id-jane', 'Jane Doe'),
      fakeRemotePlace('id-janet', 'Janet Doe'),
    ]);

    const resp = await fastify.inject({
      method: 'POST',
      url: '/api/v1/search?type=anything',
      payload: { replacement: 'Jane Doe' },
    });

    expect(resp.statusCode).to.equal(200);
    const hits = resp.json();
    expect(hits[0].uuid).to.equal('id-jane');
    expect(hits[0].chpName).to.equal('Jane Doe');
    expect(hits[0].threshold).to.equal(1);
    expect(hits[0].threshold).to.be.greaterThan(hits[1]?.threshold ?? 0);
  });

  it('respects min_threshold from query', async () => {
    searchStub.resolves([fakeRemotePlace('id-jane', 'Jane Doe')]);

    const resp = await fastify.inject({
      method: 'POST',
      url: '/api/v1/search?type=anything&min_threshold=0.99',
      payload: { replacement: 'J' }, // poor fuzzy match → low threshold
    });

    expect(resp.statusCode).to.equal(200);
    expect(resp.json()).to.deep.equal([]);
  });

  it('drops invalid sentinels from SearchLib (e.g. NoResult)', async () => {
    searchStub.resolves([
      {
        id: 'na',
        name: new UnvalidatedPropertyValue('Place Not Found'),
        placeType: 'invalid',
        lineage: [],
        uniquePlaceValues: {},
        type: 'invalid' as const,
      },
    ]);

    const resp = await fastify.inject({
      method: 'POST',
      url: '/api/v1/search?type=anything',
      payload: { replacement: 'Jane' },
    });

    expect(resp.statusCode).to.equal(200);
    expect(resp.json()).to.deep.equal([]);
  });

  it('only forwards configured hierarchy keys to SearchLib', async () => {
    searchStub.resolves([fakeRemotePlace('id-jane', 'Jane Doe')]);

    await fastify.inject({
      method: 'POST',
      url: '/api/v1/search?type=anything',
      payload: { replacement: 'Jane Doe', PARENT: 'p', UNRELATED: 'noise' },
    });

    expect(searchStub.calledOnce).to.be.true;
    const formDataPassed = searchStub.firstCall.args[1];
    expect(formDataPassed).to.deep.equal({ replacement: 'Jane Doe', PARENT: 'p' });
    expect(formDataPassed).to.not.have.property('UNRELATED');
  });

  it('uses default min_threshold when query param is omitted', async () => {
    searchStub.resolves([fakeRemotePlace('id-jane', 'Jane Doe')]);

    const resp = await fastify.inject({
      method: 'POST',
      url: '/api/v1/search?type=anything',
      payload: { replacement: 'Jane Doe' },
    });

    expect(resp.statusCode).to.equal(200);
    const hits = resp.json();
    expect(hits).to.have.length(1);
    expect(hits[0].threshold).to.equal(1);
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
