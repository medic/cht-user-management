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

  it('returns hits with name, uuid, threshold sorted desc', async () => {
    searchStub.resolves([
      fakeRemotePlace('id-janet', 'Janet Doe'),
      fakeRemotePlace('id-jane', 'Jane Doe'),
    ]);

    const resp = await fastify.inject({
      method: 'POST',
      url: '/api/v1/search?type=anything',
      payload: { replacement: 'Jane Doe' },
    });

    expect(resp.statusCode).to.equal(200);
    const hits = resp.json();
    expect(hits[0]).to.include({ uuid: 'id-jane', name: 'Jane Doe' });
    expect(hits[0].threshold).to.be.closeTo(1, 0.001);
    expect(hits[0].threshold).to.be.greaterThan(hits[1].threshold);
  });

  it('drops hits below the query threshold', async () => {
    searchStub.resolves([fakeRemotePlace('id-jane', 'Jane Doe')]);

    // 0.99999... < 1.0 → exact match still gets filtered out
    const resp = await fastify.inject({
      method: 'POST',
      url: '/api/v1/search?type=anything&threshold=1',
      payload: { replacement: 'Jane Doe' },
    });

    expect(resp.statusCode).to.equal(200);
    expect(resp.json()).to.deep.equal([]);
  });

  it('keeps hits when query threshold is permissive', async () => {
    searchStub.resolves([fakeRemotePlace('id-jane', 'Jane Doe')]);

    const resp = await fastify.inject({
      method: 'POST',
      url: '/api/v1/search?type=anything&threshold=0',
      payload: { replacement: 'Jane Doe' },
    });

    expect(resp.statusCode).to.equal(200);
    expect(resp.json()).to.have.length(1);
    expect(resp.json()[0].uuid).to.equal('id-jane');
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
