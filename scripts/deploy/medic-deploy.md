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

### Continuous Deployment

The [GitHub Actions workflow](../../.github/workflows/deploy-config.yml#L22) automatically handles secret decryption and deployment. When changes are merged to main, the workflow decrypts the secrets using the SOPS key and includes them in the Helm deployment.

### Known Configurations:

As each deployment needs its own configuration directory, DNS entry and deployment name, we'll list them here and the commands below can be used by replacing the correct value.

| Name         | Config           | Values                | EKS-Deployment | URL |
|--------------|------------------|-----------------------|--              |--   |   
| MoH Togo     | `users-chis-tg`  | `users-chis-tg.yaml`  | `users-chis-tg-cht-user-management` | users-chis-tg.app.medicmobile.org | 
| MoH Mali CIV | `users-chis-civ` | `users-chis-civ.yaml` | `users-chis-civ-cht-user-management` | users-chis-civ.app.medicmobile.org | 
| MoH Mali CHW | `users-chis-ml`  | `users-chis-ml.yaml`   | `users-chis-ml-cht-user-management` | users-chis-ml.app.medicmobile.org | 

### Prepare a Deployment

To prepare a deployment, use the following steps to ensure your environment is properly configured.
The `helm install` and `helm upgrade` commands should be run in the `./scripts/deploy` directory in this repo.

1. Check that the current main and work images are [published](https://github.com/medic/cht-user-management/tree/main#publishing-new-docker-images) to [ECR](https://gallery.ecr.aws/medic/cht-user-management) 
2. Ensure the `tag:` in the respective `values.yaml` file located in the [values folder](https://github.com/medic/cht-user-management/blob/main/scripts/deploy/values/) is the version you wish to deploy.
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
      --set cht-user-management.image.tag=$PKG_VERSION --set cht-user-management-worker.image.tag=$PKG_VERSION \
      $CONFIG medic/cht-user-management
```

#### Upgrade 

While Upgrade can be done manually, normally this is done through CD.  Run manually if needed.  Replace `$VALUES` and `$CONFIG` from the [table](#known-cofigurations) above:

```shell
helm upgrade \
      --kube-context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod \
      --values values/$VALUES \
      --set cht-user-management.image.tag=$PKG_VERSION --set cht-user-management-worker.image.tag=$PKG_VERSION \
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
      --set cht-user-management.image.tag=$PKG_VERSION --set cht-user-management-worker.image.tag=$PKG_VERSION \
      $CONFIG medic/cht-user-management
```

## Managing Secrets

### For Medic-hosted Deployments
- Get the SOPS private key and public key from 1Password.
- Place the private key in `scripts/deploy/secrets/key.txt` (**never commit this**).
- Place the public key and rules in `scripts/deploy/secrets/.sops.yaml` (**commit this**).
- Edit your secrets YAML (e.g., `users-chis-xx-secrets.yaml`), then encrypt with SOPS:
  ```bash
  sops --encrypt --input-type yaml --output-type yaml secrets.yaml > users-chis-xx-secrets.yaml
  ```
- Commit the encrypted secrets file and `.sops.yaml`.
- CI/CD will automatically decrypt using the private key from 1Password and inject secrets into the deployment.

### For Self-hosted Deployments

- You can create a plain `users-chis-xx-secrets.yaml` file (not committed to the repo) in `scripts/deploy/secrets/` with your sensitive values:
  ```yaml
  cht-user-management:
      env:
          CHIS_KE_SUPERSET_BASE_URL: ...
          CHIS_KE_SUPERSET_ADMIN_USERNAME: ...
          CHIS_KE_SUPERSET_ADMIN_PASSWORD: ...
  ```
- Alternatively, set these values as environment variables directly (e.g., in your Docker Compose file or CI/CD system).
- If you want to use SOPS for encrypted secrets and CI/CD, you can follow the Medic-hosted instructions above.
- **Do not commit secrets or private keys to the repo.**

### What to Commit
- Commit: `.sops.yaml`, encrypted `[config]-secrets.yaml` files
- Do NOT commit: `key.txt` (private key), unencrypted secrets

### How CI/CD Handles Secrets
- The pipeline decrypts secrets using the SOPS private key (from 1Password) and injects them into the deployment.
- No manual decryption is needed during deployment.
