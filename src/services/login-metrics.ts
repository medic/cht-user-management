export class LoginMetrics{

  public loginSuccessCount: number = 0;
  public loginFailureCount: number = 0;
  public loginFailureReason: string = ''; 

}

export const loginMetricsData = new LoginMetrics();
