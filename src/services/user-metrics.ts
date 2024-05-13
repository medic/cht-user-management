
export class UserMetrics{

  public createUserSuccessCount: number = 0;
  public createUserFailureCount: number = 0;
  public createUserRetry: number = 0;
  public createUserTime: number = 0;
  
}

export const userMetricsData = new UserMetrics();
