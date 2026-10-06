## Medic Deployment

This readme talks about how to use `helm` and `kubectl` running locally on your workstation to create, update and delete instances of the CHT User Management tool. These run in Medic's [EKS](https://docs.aws.amazon.com/eks/latest/userguide/what-is-eks.html), and these instructions are meant for Medic teammates who have access to EKS. Everyone else is welcome to use them as an example for their own infrastructure.

The deployments use Medic's [`cht-user-management` chart](https://github.com/medic/helm-charts), with one values file each in [`values/`](values). The previous version's values are kept in [`docs/legacy/deploy`](../../docs/legacy/deploy).

**Deploys are automatic.** Each release publishes an image, and [`deploy.yml`](../../.github/workflows/deploy.yml) then upgrades `users-chis-civ`, `users-chis-tg` and `users-chis-ml` to it, one after the other: it creates each one's archive volume if it's missing, runs `helm upgrade --wait --atomic` (which rolls back to the running version if the new one doesn't become healthy), and checks `/_healthz` on its public address. A deployment that fails doesn't stop the others, and the workflow run fails, naming it. The commands below are for a first install, or for doing the same by hand.

### Key/Value pairs used

| Key       | Value                                                   |
| --------- | ------------------------------------------------------- |
| context   | arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks |
| namespace | users-chis-prod                                         |

### Requirements

- [Helm](https://helm.sh/) and [kubectl](https://kubernetes.io/docs/reference/kubectl/kubectl/) on your workstation
- The chart repository: `helm repo add medic https://docs.communityhealthtoolkit.org/helm-charts`
- Access to [Medic's Kubernetes cluster (EKS)](https://github.com/medic/medic-infrastructure/blob/master/terraform/aws/dev/eks/access/README.md)

### Known configurations

| Name         | Config           | Values                | EKS-Deployment                       | URL                                |
| ------------ | ---------------- | --------------------- | ------------------------------------ | ---------------------------------- |
| MoH Togo     | `users-chis-tg`  | `users-chis-tg.yaml`  | `users-chis-tg-cht-user-management`  | users-chis-tg.app.medicmobile.org  |
| MoH Mali CIV | `users-chis-civ` | `users-chis-civ.yaml` | `users-chis-civ-cht-user-management` | users-chis-civ.app.medicmobile.org |
| MoH Mali CHW | `users-chis-ml`  | `users-chis-ml.yaml`  | `users-chis-ml-cht-user-management`  | users-chis-ml.app.medicmobile.org  |

`users-chis-ke-redirect.yaml` isn't a Helm release: it's an Ingress that sends users-chis-ke.app.medicmobile.org to users.echis.go.ke. Apply it with `kubectl apply -f values/users-chis-ke-redirect.yaml`.

Each values file sets, among the rest:

- `DEPLOYMENT_DIR`: the deployment's folder in the image (contact types, CHT instances, logo)
- `REDIS_URL`: the release's own Redis
- a volume at `/app/data` for the archives of deleted and merged places, which undo needs, and `fsGroup: 1000` so the app can write to it
- a memory limit for the move, merge and delete jobs, which run cht-conf in the same container
- the worker at 0 replicas: it's part of the app now, but still in the chart

The health checks use `GET /_healthz`. Behind the load balancer, which keeps the `Host` header, `ORIGIN` isn't needed, and the image already sets `BODY_SIZE_LIMIT` for CSV files up to 5 MB.

### Prepare a deployment

Run the commands below in this folder (`scripts/deploy`).

1. Check that the version you want is [published](https://gallery.ecr.aws/medic/cht-user-management): every release publishes an image, tagged with its version.
2. Update your charts: `helm repo update medic`.
3. **Once per deployment, before its first install:** create the volume for its archives:

```shell
sed "s/RELEASE/$CONFIG/" data-volume.yaml | kubectl \
      --context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod apply -f -
```

4. **Check the secret's `SECRET_KEY`.** The app needs 64 hex characters. The chart creates its secret on the first install and keeps it after, but chart 0.2.3 generates a `SECRET_KEY` the app can't use (it isn't base64-encoded in the secret), and the app then refuses to start, saying so in its log. Existing deployments keep the key they have. For a new one, set it after the first install, then restart:

```shell
kubectl --context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks --namespace users-chis-prod \
      patch secret $CONFIG-cht-user-management --type merge \
      -p "{\"stringData\":{\"SECRET_KEY\":\"$(openssl rand -hex 32)\"}}"
kubectl --context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks --namespace users-chis-prod \
      rollout restart deploy/$CONFIG-cht-user-management
```

Changing `SECRET_KEY` makes everything already stored unreadable: staged lists and generated passwords. Only set it on a new deployment.

#### Install (only once!)

Replace `$VALUES` and `$CONFIG` from the [table](#known-configurations) above, and `$PKG_VERSION` with the version to deploy:

```shell
helm install \
      --kube-context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod \
      --values values/$VALUES \
      --set cht-user-management.image.tag=$PKG_VERSION \
      $CONFIG medic/cht-user-management
```

#### Upgrade

```shell
helm upgrade \
      --kube-context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod \
      --values values/$VALUES \
      --set cht-user-management.image.tag=$PKG_VERSION \
      $CONFIG medic/cht-user-management
```

Always pass the image tag: without it, the chart deploys its own default version.

#### Upgrading from the previous version

The first upgrade from the previous version (2.x) to this one:

- needs the volume created first ([step 3](#prepare-a-deployment)); the secret's keys carry over
- scales the old worker down to 0
- signs everyone out: sessions are kept differently, so users sign in again
- starts with empty staged lists: the previous version's lists and logs, still in the release's Redis, aren't read, and can be removed once the new version is in use

### How to

#### List all helm deployments

```shell
helm --kube-context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod list --all
```

#### Check history of a deployment

```shell
helm --kube-context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod history $CONFIG
```

#### Get current configuration of a deployment

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

A deployment that won't start says why in its log, eg. a missing setting or a malformed deployment folder:

```shell
kubectl --context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod logs deploy/$EKS-DEPLOYMENT
```

#### Get more details of a deployment

```shell
kubectl --context arn:aws:eks:eu-west-2:720541322708:cluster/prod-cht-eks \
      --namespace users-chis-prod describe deploy/$EKS-DEPLOYMENT
```
