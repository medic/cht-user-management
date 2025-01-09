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


### Known cofigurations:

As each deployment needs its own configuration directory, DNS entry and deployment name, we'll list them here and the commands below can be used by replacing the correct value.

| Name | Config | Values | EKS-Deployment | URL |
|--    |--      |--      |--              |--   |   
| MoH Kenya | `users-chis-ke`| `users-chis-ke.yaml` | `users-chis-ke-cht-user-management` | users-chis-ke.app.medicmobile.org | 
| MoH Togo | `users-chis-tg`| `users-chis-tg.yaml` | `users-chis-tg-cht-user-management` | users-chis-tg.app.medicmobile.org | 
| MoH Uganda | `users-chis-ug`| `users-chis-ug.yaml` | `users-chis-ug-cht-user-management` | users-chis-ug.app.medicmobile.org | 
| MoH Mali CIV | `users-chis-civ`| `users-chis-civ.yaml` | `users-chis-civ-cht-user-management` | users-chis-civ.app.medicmobile.org | 

### Prepare a Deployment

To prepare a deployment, use the following steps to ensure your environment is properly configured.
The `helm install` and `helm upgrade` commands should be run in the `./scripts/deploy` directory in this repo.

1. Check the image is [published](https://github.com/medic/cht-user-management/tree/main#publishing-new-docker-images) to [ECR](https://gallery.ecr.aws/medic/cht-user-management) 
2. Update the `tag:` in the respective `values.yaml` file located in the [values folder](https://github.com/medic/cht-user-management/blob/main/scripts/deploy/values/) to match the version you wish to deploy. There are two places to update: `cht-user-management` and `cht-user-management-worker`
3. Ensure your local system has the latest charts by running:
```bash
helm repo update medic
```
4. Run either `helm install...` or `helm upgrade...` per the full commands below. (commands should be run in the `./scripts/deploy` directory in this repo)

#### Install (only once!)

  Replace `$VALUES` and `$CONFIG` from the  [table](#known-cofigurations) above:

```shell
helm install \
      --kube-context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod \
      --values values/$VALUES \
      $CONFIG medic/cht-user-management
```

#### Upgrade 

Run when ever you need to upgrade.  Replace `$VALUES` and `$CONFIG` from the [table](#known-cofigurations) above:

```shell
helm upgrade \
      --kube-context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod \
      --values values/$VALUES \
      $CONFIG medic/cht-user-management
```

> [!NOTE]
> If you encounter issues, you may need to first delete existing helm values and then reinstall with the new values, as outlined in this [section](#delete-existing-values-in-order-to-redeploy).

### How to

#### List all helm deployments
```shell
helm --kube-context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod list --all
```

#### Check history of a deployment

_You can get `$deployment_name` from the `list --all` command above_ or see `$CONFIG` from the [table](#known-cofigurations) above:

```shell
helm --kube-context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod \
      history $CONFIG 
```

#### Get current configuration of a deployment

See values for `$CONFIG` from the [table](#known-cofigurations) above:

```shell
helm --kube-context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod get values $CONFIG 
```

#### List all resources in a namespace
```shell
kubectl --context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod get all
```

#### View logs of a deployment

See values for `$EKS-DEPLOYMENT` from the [table](#known-cofigurations) above:

```shell
kubectl --context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod logs deploy/$EKS-DEPLOYMENT
```
_You can replace `deploy/x` with for example `pods/y` from the get all command above_ or see values for `$EKS-DEPLOYMENT` from the [table](#known-cofigurations) above:

#### Get more details of a deployment

```shell
kubectl --context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod describe deploy/$EKS-DEPLOYMENT
```

#### Delete existing values in order to redeploy

  1. Delete existing values if encountering issues
```shell
helm --namespace users-chis-prod users-chis-prod delete $CONFIG
```

  2. Reinstall with updated values
```shell
helm install \
      --kube-context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod \
      --values values/$VALUES \
      $CONFIG medic/cht-user-management
```