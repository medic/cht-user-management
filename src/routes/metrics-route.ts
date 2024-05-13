import { FastifyInstance } from 'fastify';
import { loginMetricsData } from '../services/login-metrics';
import { userMetricsData } from '../services/user-metrics';

export default async function metrics(fastify: FastifyInstance) {
  
  fastify.get('/metrics', async (req, resp) => {
  
    let metrics = '';
    
    // Login metrics
    metrics += '# Logins { success count, failure count, p2 failure reason } \n success count '+loginMetricsData.loginSuccessCount;
    metrics += '\n# Logins { success count, failure count, p2 failure reason } \n failure count '+loginMetricsData.loginFailureCount;
    
    //User creation metrics
    metrics += '\n# Count of created users { success, failure, retries, p2 time to upload } \n success count '+userMetricsData.createUserSuccessCount;
    metrics += '\n# Count of created users { success, failure, retries, p2 time to upload } \n failure count '+userMetricsData.createUserFailureCount;

    return resp.send(metrics);
  });
  
}
