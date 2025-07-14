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

### Production Environment Secrets

The CHT User Management tool uses SOPS (Secrets OPerationS) to securely manage sensitive environment variables in production. This is particularly important for credentials that shouldn't be stored in plain text in the Helm values files (e.g., Superset admin credentials used for API access).

Each configuration will have its own encrypted secrets file (e.g, `users-chis-tg-secrets.yaml`).

#### Getting Started with Secrets

1. **For Medic Hosted Deployment**:
   - Get both the SOPS private key and public key from [1Password](https://start.1password.com/open/i?a=ZXKW4QPXKNF7LMQXIV73EG6Y5Q&v=dnrhbauihkhjs5ag6fwn2zhazi&i=4z4lw7l4nbhwrbfl3xqkf7h4ni&h=team-medic.1password.com)
   - Create `scripts/deploy/secrets/key.txt` with the private key
   - Create `scripts/deploy/secrets/.sops.yaml` with the public key and encryption rules
   - Use `manage-secrets.sh` to manage secrets

2. **For Self Hosted Deployment**:
   - Generate a new SOPS key pair for your deployment:
     ```bash
     ./manage-secrets.sh init
     ```
   - This creates:
     - `scripts/deploy/secrets/key.txt`: Contains your private key (keep this secure)
     - `scripts/deploy/secrets/.sops.yaml`: Contains the correct creation rule from encryption
   - Store the private key securely - it will be needed for future secret management
   - Never commit the private key to version control

#### Managing Production Secrets

The `manage-secrets.sh` script helps you manage sensitive environment variables that shouldn't be stored in plain text in the Helm values files. For example, when setting up Superset integration, you'll need to store admin credentials securely.

1. **Add/Update Secrets**:
   ```bash
   ./manage-secrets.sh add chis-ke
   ```
   The script will:
   - Prompt for environment variable name (without the config prefix)
   - Prompt for the secret value
   - Automatically add the config prefix (e.g., `CHIS_KE_` for Kenya)
   - Create/update `scripts/deploy/secrets/users-chis-ke-secrets.yaml`
   - Encrypt the secrets using SOPS
   - The encrypted file should be committed to git

   Example:
   ```
   ENV var (without CHIS_KE_ prefix, or Enter to finish): SUPERSET_ADMIN_PASSWORD
   Enter value: your-secure-password
   ✓ Added CHIS_KE_SUPERSET_ADMIN_PASSWORD
   ```

2. **View Secrets**:
   ```bash
   ./manage-secrets.sh decrypt chis-ke
   ```

> [!NOTE]
> These encrypted secrets are only used in production environments. For development, you can use plain text values in `.env` file.

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
