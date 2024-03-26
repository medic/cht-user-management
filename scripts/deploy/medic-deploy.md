## Medic Deployment

This readme talks about how to use `helm` and `kubect`  running locally on your workstation to create, update and delete instances of the CHT User Management tool.  These will be running in Medic's [EKS](https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html) and these instructions are meant to be followed by Medic teammates who have access to EKS.

General public is welcome to look at these instructions for who they might use them in their own infrastructure. 

### Key/Value pairs used 
| Key       | Value                                                   |
|-----------|---------------------------------------------------------|
| context   | arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks |
| namespace | users-chis-prod                                         |

### Requirements:
- Have both [Helm](https://helm.sh/) and  [Kubectl](https://kubernetes.io/docs/reference/kubectl/kubectl/) installed on your local workstation
- Check out [helm chart repository](https://github.com/medic/helm-charts/tree/main#usage) so you can reference it locally
- Be able to [authenticate to Medic kubernetes cluster (EKS)](https://github.com/medic/medic-infrastructure/blob/master/terraform/aws/dev/eks/access/README.md)


### Deploy new version

These commands should be run in the `./scripts/deploy` directory in this repo. Also note you may need to replace `medic/cht-user-management` with the full path to the helm chart repository you checked out above. Ensure the image has [been published](https://github.com/medic/cht-user-management/tree/main#publishing-new-docker-images) first [to ECR](https://gallery.ecr.aws/medic/cht-user-management) and also that the respective `values.yaml` file (in [values folder](https://github.com/medic/cht-user-management/blob/main/scripts/deploy/values/)) has the same version in the `tag:` as the new image.

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
#### TG
```shell
# Edit tag in users-chis-tg.yaml and then run:

helm upgrade \
      --kube-context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod \
      --values values/users-chis-tg.yaml \
      users-chis-tg medic/cht-user-management
```
### How to

#### List all helm deployments
```shell
helm --kube-context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod list --all
```

#### Check history of a deployment

_You can get `$deployment_name` from the `list --all` command above_

```shell
helm --kube-context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod \
      history $deployment_name
```

#### Get current configuration of a deployment
```shell
helm --kube-context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod get values $deployment_name
```

#### List all resources in a namespace
```shell
kubectl --context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod get all
```

#### View logs of a deployment
```shell
kubectl --context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod logs deploy/users-chis-ke-cht-user-management
# or
kubectl --context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod logs deploy/users-chis-ug-cht-user-management
# or
kubectl --context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod logs deploy/users-chis-tg-cht-user-management
```
_You can replace `deploy/x` with for example `pods/y` from the get all command above_

#### Get more details of a deployment
```shell
kubectl --context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod describe deploy/users-chis-ke-cht-user-management
# or
kubectl --context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod describe deploy/users-chis-ug-cht-user-management
# or
kubectl --context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod describe deploy/users-chis-tg-cht-user-management
```
