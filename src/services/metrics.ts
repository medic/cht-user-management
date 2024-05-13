import { UserMetrics } from './user-metrics';
import { PageView } from './page-view';
import { LoginMetrics } from './login-metrics';

export const userMetricsData: UserMetrics[] = [];
export const pageViewMetricsData: PageView[] = [];
export const loginMetricsData: LoginMetrics[] = [];

export function setRequestDataMetrics(req: any, resp: any){
  const metric = new PageView();
  metric.method = req.routeOptions.method;
  metric.path = req.url;
  metric.statusCode = resp.statusCode;
  pageViewMetricsData.push(metric);
}

export function summarizeUserMetrics(): UserMetrics{
  const summarizedMetrics = new UserMetrics();

  for (const data of userMetricsData){
    summarizedMetrics.createUserSuccessCount += data.createUserSuccessCount;
    summarizedMetrics.createUserFailureCount += data.createUserFailureCount;
    summarizedMetrics.createUserRetry += data.createUserRetry;
    summarizedMetrics.createUserTime += data.createUserTime;
  }

  return summarizedMetrics;
}


export function summarizeLoginMetrics(): LoginMetrics{
  const summarizedLoginMetrics = new LoginMetrics();

  for (const loginMetric of loginMetricsData){
    summarizedLoginMetrics.loginSuccessCount += loginMetric.loginSuccessCount;
    summarizedLoginMetrics.loginFailureCount += loginMetric.loginFailureCount;
  }

  return summarizedLoginMetrics;
}



