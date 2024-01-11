## Medic Deployment

This readme talks about how to use `helm` and `kubect`  running locally on your workstation to create, update and delete instances of the CHT User Management tool.  These will be running in Medic's [EKS](https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html) and these instructions are meant to be followed by Medic teammates who have access to EKS.

General public is welcome to look at these instructions for who they might use them in their own infrastructure. 

### Key/Value pairs used 
| Key       | Value                                                   |
|-----------|---------------------------------------------------------|
| context   | arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks |
| namespace | users-chis-prod                                         |

### Requirements:
1. Applications:
  - [Helm](https://helm.sh/)
  - [Kubectl](https://kubernetes.io/docs/reference/kubectl/kubectl/)

2. [Add medic helm chart repository](https://github.com/medic/helm-charts/tree/main#usage)

3. [Authenticate to Medic kubernetes cluster (EKS)](https://github.com/medic/medic-infrastructure/blob/master/terraform/aws/dev/eks/access/README.md)


### Deploy new version

#### KE
```shell
# Edit tag in users-chis-ke.yaml and then run:

helm upgrade \
      --kube-context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod \
      --values values/users-chis-ke.yaml \
      users-chis-ke medic/cht-user-management
```
#### UG
```shell
# Edit tag in users-chis-ug.yaml and then run:

helm upgrade \
      --kube-context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod \
      --values values/users-chis-ug.yaml \
      users-chis-ug medic/cht-user-management
```
### How to

#### List all helm deployments
```shell
helm --kube-context $context --namespace $namespace list --all
```

#### Check history of a deployment
```shell
helm --kube-context $context --namespace $namespace history $deployment_name
```
_You can get `deployment_name` from the helm list command above_

#### Get current configuration of a deployment
```shell
helm --kube-context $context --namespace $namespace get values $deployment_name
```

#### List all resources in a namespace
```shell
kubectl --context $context --namespace $namespace get all
```

#### View logs of a deployment
```shell
kubectl --context $context --namespace $namespace logs deploy/users-chis-ke-cht-user-management
# or
kubectl --context $context --namespace $namespace logs deploy/users-chis-ug-cht-user-management
```
_You can replace `deploy/x` with for example `pods/y` from the get all command above_

#### Get more details of a deployment
```shell
kubectl --context $context --namespace $namespace describe deploy/users-chis-ke-cht-user-management
# or
kubectl --context $context --namespace $namespace describe deploy/users-chis-ug-cht-user-management
```
