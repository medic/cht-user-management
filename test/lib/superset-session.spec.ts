import Chai from 'chai';
import rewire from 'rewire';
import sinon from 'sinon';

import { Config } from '../../src/config';
const SupersetSession = rewire('../../src/lib/superset-session');

import chaiAsPromised from 'chai-as-promised';
Chai.use(chaiAsPromised);

const { expect } = Chai;

describe('lib/superset-session.ts', () => {
  let mockAxios: any;
  let mockConfig: any;

  beforeEach(() => {
    mockAxios = {
      post: sinon.stub().resolves({
        data: { access_token: 'test-token' },
        headers: { 'set-cookie': ['test-cookie'] }
      }),
      get: sinon.stub().resolves({
        data: { result: 'test-csrf' },
        headers: { 'set-cookie': ['test-cookie'] }
      }),
      defaults: {
        headers: {
          common: {}
        }
      }
    };

    mockConfig = {
      getSupersetBaseUrl: sinon.stub().returns('https://test.example.com'),
      getSupersetCredentials: sinon.stub().returns({
        username: 'admin',
        password: 'password'
      })
    };

    sinon.stub(Config, 'getSupersetBaseUrl').callsFake(mockConfig.getSupersetBaseUrl);
    sinon.stub(Config, 'getSupersetCredentials').callsFake(mockConfig.getSupersetCredentials);

    SupersetSession.__set__('axios', {
      create: sinon.stub().returns(mockAxios),
      ...mockAxios,
    });

    // Speed up retry tests by stubbing delay to resolve immediately
    sinon.stub(SupersetSession.default.prototype, 'delay').callsFake(() => Promise.resolve());
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should initialize session with proper tokens', async () => {
    const session = await SupersetSession.default.create();

    expect(session.axiosInstance.defaults.headers.common).to.include({
      Authorization: 'Bearer test-token',
      'X-CSRFToken': 'test-csrf',
      Cookie: 'test-cookie'
    });
  });

  it('should handle retries on initialization failure', async () => {
    mockAxios.post
      .onFirstCall().rejects(new Error('Network error'))
      .onSecondCall().resolves({
        data: { access_token: 'test-token' },
        headers: { 'set-cookie': ['test-cookie'] }
      });

    const session = await SupersetSession.default.create();
    expect(session.axiosInstance.defaults.headers.common.Authorization)
      .to.equal('Bearer test-token');
  });

  it('should throw error after max retries', async function() {
    this.timeout(10000);
    
    mockAxios.post.rejects(new Error('Network error'));

    await expect(SupersetSession.default.create())
      .to.be.rejectedWith('Failed to initialize Superset session');
    
    expect(mockAxios.post.callCount).to.equal(4);
  });
});
